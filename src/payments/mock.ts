import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AllowanceStatus,
  AllowanceStatusArgs,
  ChargeSubscriptionArgs,
  CreatePlanArgs,
  GrantAllowanceArgs,
  GrantRecurringAllowanceArgs,
  IsSubscriptionActiveArgs,
  PaymentBackend,
  PaymentProof,
  PayPerCallArgs,
  SubscribeArgs,
  VerifyPaymentArgs,
} from "./types";

/**
 * MockPayments mirrors the on-chain Subscriptions & Allowances semantics in a
 * JSON file so the whole demo runs end-to-end with no validator. The server and
 * agent are separate processes, so state is persisted to disk and shared.
 */

function ledgerPath(): string {
  return process.env.MOCK_LEDGER ?? ".keys/mock-ledger.json";
}

interface AllowanceRow {
  remaining: string;
  expiresUnix: string;
}
interface RecurringRow {
  amountPerPeriod: string;
  periodLengthS: string;
  startUnix: string;
  expiryUnix: string;
  /** Start of the period the row was last accounted against. */
  currentPeriodStartUnix: string;
  /** Amount already pulled in the current period (resets each period). */
  pulledInPeriod: string;
}
interface ProofRow {
  amount: string;
  merchantAta: string;
  mint: string;
  used: boolean;
}
interface PlanRow {
  merchant: string;
  mint: string;
  amount: string;
  periodHours: string;
  createdUnix: string;
}
interface SubRow {
  planKey: string;
  subscriber: string;
  active: boolean;
  lastChargedPeriod: number;
}
interface Ledger {
  allowances: Record<string, AllowanceRow>;
  recurring: Record<string, RecurringRow>;
  proofs: Record<string, ProofRow>;
  plans: Record<string, PlanRow>;
  subscriptions: Record<string, SubRow>;
  counter: number;
}

function emptyLedger(): Ledger {
  return { allowances: {}, recurring: {}, proofs: {}, plans: {}, subscriptions: {}, counter: 0 };
}

async function load(): Promise<Ledger> {
  try {
    const raw = await fs.readFile(ledgerPath(), "utf8");
    return { ...emptyLedger(), ...(JSON.parse(raw) as Partial<Ledger>) };
  } catch {
    return emptyLedger();
  }
}

async function save(l: Ledger): Promise<void> {
  const p = ledgerPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(l, null, 2));
}

function nowUnix(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** Start of the period containing `now`, given a delegation that began at `start`. */
function periodStartFor(start: bigint, period: bigint, now: bigint): bigint {
  if (period <= 0n || now <= start) return start;
  return start + ((now - start) / period) * period;
}

const aKey = (delegator: string, delegatee: string, mint: string, nonce: bigint) =>
  `${delegator}:${delegatee}:${mint}:${nonce}`;
const pKey = (merchant: string, planId: bigint) => `${merchant}:${planId}`;
const sKey = (planKey: string, subscriber: string) => `${planKey}:${subscriber}`;

export class MockPayments implements PaymentBackend {
  readonly kind = "mock" as const;

  async ataFor(owner: string, mint: string): Promise<string> {
    return `mock-ata:${owner}:${mint}`;
  }

  async grantAllowance(a: GrantAllowanceArgs): Promise<void> {
    const l = await load();
    l.allowances[aKey(a.delegator.address, a.delegatee, a.mint, a.nonce ?? 0n)] = {
      remaining: a.amount.toString(),
      expiresUnix: a.expiryUnix.toString(),
    };
    await save(l);
  }

  async allowanceStatus(a: AllowanceStatusArgs): Promise<AllowanceStatus> {
    const l = await load();
    const row = l.allowances[aKey(a.delegator, a.delegatee, a.mint, a.nonce ?? 0n)];
    if (!row) return { exists: false, remaining: 0n, expiresUnix: 0n };
    return { exists: true, remaining: BigInt(row.remaining), expiresUnix: BigInt(row.expiresUnix) };
  }

  async payPerCall(a: PayPerCallArgs): Promise<PaymentProof> {
    const l = await load();
    const key = aKey(a.delegator, a.delegatee.address, a.mint, a.nonce ?? 0n);
    const row = l.allowances[key];
    if (!row) throw new Error("No allowance for this agent. Run `npm run allowance:grant`.");
    const remaining = BigInt(row.remaining);
    const expires = BigInt(row.expiresUnix);
    if (expires !== 0n && nowUnix() > expires) throw new Error("Allowance expired.");
    if (remaining < a.amount) {
      throw new Error(`Allowance exhausted: remaining ${remaining} < price ${a.amount}.`);
    }
    row.remaining = (remaining - a.amount).toString();
    const reference = `mock-tx-${++l.counter}`;
    l.proofs[reference] = {
      amount: a.amount.toString(),
      merchantAta: a.merchantAta,
      mint: a.mint,
      used: false,
    };
    await save(l);
    return { reference, amount: a.amount };
  }

  async verifyPayment(a: VerifyPaymentArgs): Promise<boolean> {
    const l = await load();
    const p = l.proofs[a.proof];
    if (!p || p.used) return false;
    if (p.merchantAta !== a.merchantAta || p.mint !== a.mint) return false;
    if (BigInt(p.amount) < a.minAmount) return false;
    p.used = true; // replay protection
    await save(l);
    return true;
  }

  // --- Recurring delegation: a per-period budget that refills each period.
  // Mirrors the on-chain RecurringDelegation account (amountPerPeriod, period,
  // amountPulledInPeriod resetting each period).

  async grantRecurringAllowance(a: GrantRecurringAllowanceArgs): Promise<void> {
    const l = await load();
    l.recurring[aKey(a.delegator.address, a.delegatee, a.mint, a.nonce ?? 0n)] = {
      amountPerPeriod: a.amountPerPeriod.toString(),
      periodLengthS: a.periodLengthS.toString(),
      startUnix: a.startUnix.toString(),
      expiryUnix: a.expiryUnix.toString(),
      currentPeriodStartUnix: a.startUnix.toString(),
      pulledInPeriod: "0",
    };
    await save(l);
  }

  async payPerPeriod(a: PayPerCallArgs): Promise<PaymentProof> {
    const l = await load();
    const key = aKey(a.delegator, a.delegatee.address, a.mint, a.nonce ?? 0n);
    const row = l.recurring[key];
    if (!row) throw new Error("No recurring allowance for this agent. Run `npm run recurring:grant`.");
    const now = nowUnix();
    const expiry = BigInt(row.expiryUnix);
    if (expiry !== 0n && now > expiry) throw new Error("Recurring allowance expired.");
    const start = BigInt(row.startUnix);
    if (now < start) throw new Error("Recurring allowance has not started yet.");
    const period = BigInt(row.periodLengthS);
    const perPeriod = BigInt(row.amountPerPeriod);
    // Roll the period forward if we've crossed a boundary (the on-chain reset).
    const curStart = periodStartFor(start, period, now);
    if (curStart > BigInt(row.currentPeriodStartUnix)) {
      row.currentPeriodStartUnix = curStart.toString();
      row.pulledInPeriod = "0";
    }
    const pulled = BigInt(row.pulledInPeriod);
    if (pulled + a.amount > perPeriod) {
      throw new Error(`Per-period cap exceeded: ${pulled + a.amount} > ${perPeriod} this period.`);
    }
    row.pulledInPeriod = (pulled + a.amount).toString();
    const reference = `mock-rec-${++l.counter}`;
    l.proofs[reference] = {
      amount: a.amount.toString(),
      merchantAta: a.merchantAta,
      mint: a.mint,
      used: false,
    };
    await save(l);
    return { reference, amount: a.amount };
  }

  async recurringStatus(a: AllowanceStatusArgs): Promise<AllowanceStatus> {
    const l = await load();
    const row = l.recurring[aKey(a.delegator, a.delegatee, a.mint, a.nonce ?? 0n)];
    if (!row) return { exists: false, remaining: 0n, expiresUnix: 0n };
    const now = nowUnix();
    const start = BigInt(row.startUnix);
    const period = BigInt(row.periodLengthS);
    const perPeriod = BigInt(row.amountPerPeriod);
    const periodRolled = periodStartFor(start, period, now) > BigInt(row.currentPeriodStartUnix);
    const remaining = periodRolled ? perPeriod : perPeriod - BigInt(row.pulledInPeriod);
    return { exists: true, remaining, expiresUnix: BigInt(row.expiryUnix) };
  }

  async createPlan(a: CreatePlanArgs): Promise<void> {
    const l = await load();
    l.plans[pKey(a.merchant.address, a.planId)] = {
      merchant: a.merchant.address,
      mint: a.mint,
      amount: a.amount.toString(),
      periodHours: a.periodHours.toString(),
      createdUnix: nowUnix().toString(),
    };
    await save(l);
  }

  async subscribe(a: SubscribeArgs): Promise<void> {
    const l = await load();
    const planKey = pKey(a.merchant, a.planId);
    if (!l.plans[planKey]) throw new Error("Plan not found. Run `npm run plan:create`.");
    l.subscriptions[sKey(planKey, a.subscriber.address)] = {
      planKey,
      subscriber: a.subscriber.address,
      active: true,
      lastChargedPeriod: -1,
    };
    await save(l);
  }

  async chargeSubscription(a: ChargeSubscriptionArgs): Promise<PaymentProof> {
    const l = await load();
    const planKey = pKey(a.merchant, a.planId);
    const sub = l.subscriptions[sKey(planKey, a.subscriber)];
    if (!sub || !sub.active) throw new Error("No active subscription for this subscriber.");
    const plan = l.plans[planKey];
    if (!plan) throw new Error("Plan not found.");
    const elapsed = nowUnix() - BigInt(plan.createdUnix);
    const period = Number(elapsed / (BigInt(plan.periodHours) * 3600n));
    if (sub.lastChargedPeriod >= period) {
      throw new Error(`Period ${period} already charged (recurring caps do not stack).`);
    }
    sub.lastChargedPeriod = period;
    const reference = `mock-sub-${++l.counter}`;
    l.proofs[reference] = {
      amount: a.amount.toString(),
      merchantAta: a.merchantAta,
      mint: a.mint,
      used: false,
    };
    await save(l);
    return { reference, amount: a.amount };
  }

  async isSubscriptionActive(a: IsSubscriptionActiveArgs): Promise<boolean> {
    const l = await load();
    const sub = l.subscriptions[sKey(pKey(a.merchant, a.planId), a.subscriber)];
    return !!sub && sub.active;
  }
}
