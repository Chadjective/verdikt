import type { Wallet } from "../solana/client";

/** Proof a payment happened: an on-chain tx signature (chain) or a synthetic id (mock). */
export interface PaymentProof {
  reference: string;
  amount: bigint;
}

export interface AllowanceStatus {
  exists: boolean;
  remaining: bigint;
  /** Unix seconds; 0 = no expiry. */
  expiresUnix: bigint;
}

export interface GrantAllowanceArgs {
  /** Budget owner (user) who authorizes the agent to pull. */
  delegator: Wallet;
  /** Agent address permitted to pull. */
  delegatee: string;
  mint: string;
  /** Total cap, in token base units. */
  amount: bigint;
  /** Unix seconds; 0 = no expiry. */
  expiryUnix: bigint;
  nonce?: bigint;
}

export interface GrantRecurringAllowanceArgs {
  /** Budget owner (user) who authorizes the delegatee to pull. */
  delegator: Wallet;
  /** Address permitted to pull (e.g. the agent). */
  delegatee: string;
  mint: string;
  /** Cap that refills every period, in token base units. */
  amountPerPeriod: bigint;
  /** Period length in seconds (e.g. 86_400n = 1 day). */
  periodLengthS: bigint;
  /** When the budget activates (Unix seconds); must be >= now on-chain. */
  startUnix: bigint;
  /** Unix seconds; must be > startUnix on-chain. */
  expiryUnix: bigint;
  nonce?: bigint;
}

export interface AllowanceStatusArgs {
  delegator: string;
  delegatee: string;
  mint: string;
  nonce?: bigint;
}

export interface PayPerCallArgs {
  /** Agent signs the pull (the delegatee). */
  delegatee: Wallet;
  /** Whose budget is spent (the delegator/user). */
  delegator: string;
  mint: string;
  /** Where funds land (Avoid.net's token account). */
  merchantAta: string;
  amount: bigint;
  nonce?: bigint;
}

export interface VerifyPaymentArgs {
  proof: string;
  minAmount: bigint;
  merchantAta: string;
  mint: string;
}

export interface CreatePlanArgs {
  merchant: Wallet;
  planId: bigint;
  mint: string;
  /** Per-period price, in token base units. */
  amount: bigint;
  periodHours: bigint;
  destinations: string[];
  pullers: string[];
  metadataUri: string;
}

export interface SubscribeArgs {
  subscriber: Wallet;
  merchant: string;
  planId: bigint;
  mint: string;
}

export interface ChargeSubscriptionArgs {
  /** Merchant or a whitelisted puller. */
  caller: Wallet;
  subscriber: string;
  merchant: string;
  planId: bigint;
  mint: string;
  merchantAta: string;
  amount: bigint;
}

export interface IsSubscriptionActiveArgs {
  subscriber: string;
  merchant: string;
  planId: bigint;
  mint: string;
}

/**
 * Unified payment surface used by the server, agent, and scripts.
 * Two implementations: MockPayments (in-memory/file-backed, no chain) and
 * ChainPayments (real Solana Subscriptions & Allowances program).
 */
export interface PaymentBackend {
  readonly kind: "mock" | "chain";

  /** Resolve the token account (ATA) that receives funds for `owner` + `mint`. */
  ataFor(owner: string, mint: string): Promise<string>;

  // --- Agent allowance (pay-per-call) flow, via a fixed delegation ---
  grantAllowance(args: GrantAllowanceArgs): Promise<void>;
  allowanceStatus(args: AllowanceStatusArgs): Promise<AllowanceStatus>;
  payPerCall(args: PayPerCallArgs): Promise<PaymentProof>;
  verifyPayment(args: VerifyPaymentArgs): Promise<boolean>;

  // --- Recurring delegation (per-period refilling allowance) ---
  grantRecurringAllowance(args: GrantRecurringAllowanceArgs): Promise<void>;
  payPerPeriod(args: PayPerCallArgs): Promise<PaymentProof>;
  recurringStatus(args: AllowanceStatusArgs): Promise<AllowanceStatus>;

  // --- Subscription plan (recurring) flow ---
  createPlan(args: CreatePlanArgs): Promise<void>;
  subscribe(args: SubscribeArgs): Promise<void>;
  chargeSubscription(args: ChargeSubscriptionArgs): Promise<PaymentProof>;
  isSubscriptionActive(args: IsSubscriptionActiveArgs): Promise<boolean>;
}
