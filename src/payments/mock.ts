import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AllowanceStatus,
  AllowanceStatusArgs,
  ChargeSubscriptionArgs,
  CreatePlanArgs,
  GrantAllowanceArgs,
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

const LEDGER_PATH = process.env.MOCK_LEDGER ?? ".keys/mock-ledger.json";

interface AllowanceRow {
  remaining: string;
  expiresUnix: string;
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
  proofs: Record<string, ProofRow>;
  plans: Record<string, PlanRow>;
  subscriptions: Record<string, SubRow>;
  counter: number;
}

function emptyLedger(): Ledger {
  return { allowances: {}, proofs: {}, plans: {}, subscriptions: {}, counter: 0 };
}

async function load(): Promise<Ledger> {
  try {
    const raw = await fs.readFile(LEDGER_PATH, "utf8");
    return { ...emptyLedger(), ...(JSON.parse(raw) as Partial<Ledger>) };
  } catch {
    return emptyLedger();
  }
}

async function save(l: Ledger): Promise<void> {
  await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  await fs.writeFile(LEDGER_PATH, JSON.stringify(l, null, 2));
}

function nowUnix(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
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
