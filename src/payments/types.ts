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

  // --- Agent allowance (pay-per-call) flow ---
  grantAllowance(args: GrantAllowanceArgs): Promise<void>;
  allowanceStatus(args: AllowanceStatusArgs): Promise<AllowanceStatus>;
  payPerCall(args: PayPerCallArgs): Promise<PaymentProof>;
  verifyPayment(args: VerifyPaymentArgs): Promise<boolean>;

  // --- Subscription plan (recurring) flow ---
  createPlan(args: CreatePlanArgs): Promise<void>;
  subscribe(args: SubscribeArgs): Promise<void>;
  chargeSubscription(args: ChargeSubscriptionArgs): Promise<PaymentProof>;
  isSubscriptionActive(args: IsSubscriptionActiveArgs): Promise<boolean>;
}
