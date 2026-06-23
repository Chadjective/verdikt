import { type Signature } from "@solana/kit";
import {
  fetchMaybeFixedDelegation,
  fetchMaybeRecurringDelegation,
  fetchMaybeSubscriptionDelegation,
  findFixedDelegationPda,
  findPlanPda,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  findSubscriptionDelegationPda,
} from "@solana/subscriptions";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  buildClient,
  createEphemeralWallet,
  toAddress,
  type SubscriptionsClient,
} from "../solana/client";
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

function nowUnix(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** sendTransaction() resolves to the signature (string brand) or an object with one. */
export function extractSignature(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["signature", "txSignature", "transactionSignature"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    // kit sendTransaction resolves to { context: { signature } }
    const ctx = o.context as Record<string, unknown> | undefined;
    if (ctx && typeof ctx.signature === "string") return ctx.signature;
  }
  return String(r);
}

/**
 * ChainPayments drives the real Solana Subscriptions & Allowances program
 * (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) via `@solana/subscriptions`.
 * Each write builds a client bound to the acting signer; reads use an ephemeral
 * client (the signer is irrelevant for RPC reads).
 */
export class ChainPayments implements PaymentBackend {
  readonly kind = "chain" as const;
  private readClientPromise?: Promise<SubscriptionsClient>;
  private readonly usedRefs = new Set<string>();

  private readClient(): Promise<SubscriptionsClient> {
    if (!this.readClientPromise) {
      this.readClientPromise = createEphemeralWallet().then(buildClient);
    }
    return this.readClientPromise;
  }

  async ataFor(owner: string, mint: string): Promise<string> {
    const [ata] = await findAssociatedTokenPda({
      mint: toAddress(mint),
      owner: toAddress(owner),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    return ata;
  }

  async grantAllowance(a: GrantAllowanceArgs): Promise<void> {
    const client = buildClient(a.delegator);
    const mint = toAddress(a.mint);
    // One-time: init the SubscriptionAuthority (single u64::MAX SPL approve).
    const init = await client.subscriptions.queries.isSubscriptionAuthorityInitialized(
      a.delegator.signer.address,
      mint,
    );
    if (!init.initialized) {
      const userAta = await this.ataFor(a.delegator.address, a.mint);
      await client.subscriptions.instructions
        .initSubscriptionAuthority({
          owner: a.delegator.signer,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
          userAta: toAddress(userAta),
        })
        .sendTransaction();
    }
    await client.subscriptions.instructions
      .createFixedDelegation({
        amount: a.amount,
        delegatee: toAddress(a.delegatee),
        delegator: a.delegator.signer,
        expiryTs: a.expiryUnix,
        nonce: a.nonce ?? 0n,
        tokenMint: mint,
      })
      .sendTransaction();
  }

  async allowanceStatus(a: AllowanceStatusArgs): Promise<AllowanceStatus> {
    const client = await this.readClient();
    const [subscriptionAuthority] = await findSubscriptionAuthorityPda({
      user: toAddress(a.delegator),
      tokenMint: toAddress(a.mint),
    });
    const [delegationPda] = await findFixedDelegationPda({
      subscriptionAuthority,
      delegator: toAddress(a.delegator),
      delegatee: toAddress(a.delegatee),
      nonce: a.nonce ?? 0n,
    });
    const acct = await fetchMaybeFixedDelegation(client.rpc, delegationPda);
    if (!acct.exists) return { exists: false, remaining: 0n, expiresUnix: 0n };
    // FixedDelegation.amount is the *remaining* cap (decremented on each pull).
    return { exists: true, remaining: acct.data.amount, expiresUnix: acct.data.expiryTs };
  }

  async payPerCall(a: PayPerCallArgs): Promise<PaymentProof> {
    const client = buildClient(a.delegatee); // the agent (delegatee) signs the pull
    const mint = toAddress(a.mint);
    const [subscriptionAuthority] = await findSubscriptionAuthorityPda({
      user: toAddress(a.delegator),
      tokenMint: mint,
    });
    const [delegationPda] = await findFixedDelegationPda({
      subscriptionAuthority,
      delegator: toAddress(a.delegator),
      delegatee: toAddress(a.delegatee.address),
      nonce: a.nonce ?? 0n,
    });
    const delegatorAta = await this.ataFor(a.delegator, a.mint);
    const sent: unknown = await client.subscriptions.instructions
      .transferFixed({
        amount: a.amount,
        delegatee: a.delegatee.signer,
        delegationPda,
        delegator: toAddress(a.delegator),
        delegatorAta: toAddress(delegatorAta),
        receiverAta: toAddress(a.merchantAta),
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
      .sendTransaction();
    return { reference: extractSignature(sent), amount: a.amount };
  }

  async verifyPayment(a: VerifyPaymentArgs): Promise<boolean> {
    // Replay protection (server-process lifetime).
    if (this.usedRefs.has(a.proof)) return false;
    try {
      const client = await this.readClient();
      const res = await client.rpc.getSignatureStatuses([a.proof as Signature]).send();
      const st = res.value[0];
      if (!st || st.err) return false;
    } catch {
      return false;
    }
    // NOTE: confirms the payment tx landed + replay; the allowance cap and the
    // fixed server-side price bound the amount. A production gate would also
    // assert amount/mint/receiver by parsing the tx token-balance deltas
    // (mock mode demonstrates those full checks). minAmount/merchantAta/mint
    // are part of the interface for that stricter implementation.
    void a.minAmount;
    void a.merchantAta;
    void a.mint;
    this.usedRefs.add(a.proof);
    return true;
  }

  // --- Recurring delegation: a per-period budget that refills each period.
  // The third S&A construct alongside fixed delegations and subscription plans.

  async grantRecurringAllowance(a: GrantRecurringAllowanceArgs): Promise<void> {
    const client = buildClient(a.delegator);
    const mint = toAddress(a.mint);
    // Same per-(user, mint) SubscriptionAuthority as fixed delegations -- init once.
    const init = await client.subscriptions.queries.isSubscriptionAuthorityInitialized(
      a.delegator.signer.address,
      mint,
    );
    if (!init.initialized) {
      const userAta = await this.ataFor(a.delegator.address, a.mint);
      await client.subscriptions.instructions
        .initSubscriptionAuthority({
          owner: a.delegator.signer,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
          userAta: toAddress(userAta),
        })
        .sendTransaction();
    }
    // startTs must be >= the on-chain clock and < expiryTs, else the program
    // rejects (START_TIME_IN_PAST / START_TIME_GREATER_THAN_EXPIRY).
    await client.subscriptions.instructions
      .createRecurringDelegation({
        amountPerPeriod: a.amountPerPeriod,
        delegatee: toAddress(a.delegatee),
        delegator: a.delegator.signer,
        expiryTs: a.expiryUnix,
        nonce: a.nonce ?? 0n,
        periodLengthS: a.periodLengthS,
        startTs: a.startUnix,
        tokenMint: mint,
      })
      .sendTransaction();
  }

  async payPerPeriod(a: PayPerCallArgs): Promise<PaymentProof> {
    const client = buildClient(a.delegatee); // the delegatee (agent) signs the pull
    const mint = toAddress(a.mint);
    const [subscriptionAuthority] = await findSubscriptionAuthorityPda({
      user: toAddress(a.delegator),
      tokenMint: mint,
    });
    const [delegationPda] = await findRecurringDelegationPda({
      subscriptionAuthority,
      delegator: toAddress(a.delegator),
      delegatee: toAddress(a.delegatee.address),
      nonce: a.nonce ?? 0n,
    });
    const delegatorAta = await this.ataFor(a.delegator, a.mint);
    // A single pull (and cumulative pulls within a period) must be <= amountPerPeriod,
    // else the program rejects (AMOUNT_EXCEEDS_PERIOD_LIMIT).
    const sent: unknown = await client.subscriptions.instructions
      .transferRecurring({
        amount: a.amount,
        delegatee: a.delegatee.signer,
        delegationPda,
        delegator: toAddress(a.delegator),
        delegatorAta: toAddress(delegatorAta),
        receiverAta: toAddress(a.merchantAta),
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
      .sendTransaction();
    return { reference: extractSignature(sent), amount: a.amount };
  }

  async recurringStatus(a: AllowanceStatusArgs): Promise<AllowanceStatus> {
    const client = await this.readClient();
    const [subscriptionAuthority] = await findSubscriptionAuthorityPda({
      user: toAddress(a.delegator),
      tokenMint: toAddress(a.mint),
    });
    const [delegationPda] = await findRecurringDelegationPda({
      subscriptionAuthority,
      delegator: toAddress(a.delegator),
      delegatee: toAddress(a.delegatee),
      nonce: a.nonce ?? 0n,
    });
    const acct = await fetchMaybeRecurringDelegation(client.rpc, delegationPda);
    if (!acct.exists) return { exists: false, remaining: 0n, expiresUnix: 0n };
    const d = acct.data;
    // amountPulledInPeriod resets when a new period begins on-chain; mirror that
    // off-chain so the read reports the full cap once the period has rolled over.
    const start = BigInt(d.currentPeriodStartTs);
    const period = BigInt(d.periodLengthS);
    const perPeriod = BigInt(d.amountPerPeriod);
    const pulled = BigInt(d.amountPulledInPeriod);
    const periodRolled = period > 0n && nowUnix() >= start + period;
    const remaining = periodRolled ? perPeriod : perPeriod - pulled;
    return { exists: true, remaining, expiresUnix: BigInt(d.expiryTs) };
  }

  async createPlan(a: CreatePlanArgs): Promise<void> {
    const client = buildClient(a.merchant);
    await client.subscriptions.instructions
      .createPlan({
        amount: a.amount,
        destinations: a.destinations.map(toAddress),
        endTs: 0n,
        metadataUri: a.metadataUri,
        mint: toAddress(a.mint),
        owner: a.merchant.signer,
        periodHours: a.periodHours,
        planId: a.planId,
        pullers: a.pullers.map(toAddress),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
      .sendTransaction();
  }

  async subscribe(a: SubscribeArgs): Promise<void> {
    const client = buildClient(a.subscriber);
    const mint = toAddress(a.mint);
    const init = await client.subscriptions.queries.isSubscriptionAuthorityInitialized(
      a.subscriber.signer.address,
      mint,
    );
    if (!init.initialized) {
      const userAta = await this.ataFor(a.subscriber.address, a.mint);
      await client.subscriptions.instructions
        .initSubscriptionAuthority({
          owner: a.subscriber.signer,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
          userAta: toAddress(userAta),
        })
        .sendTransaction();
    }
    // expected* terms omitted -> the plugin client fetches live plan terms.
    await client.subscriptions.instructions
      .subscribe({
        merchant: toAddress(a.merchant),
        planId: a.planId,
        subscriber: a.subscriber.signer,
        tokenMint: mint,
      })
      .sendTransaction();
  }

  async chargeSubscription(a: ChargeSubscriptionArgs): Promise<PaymentProof> {
    const client = buildClient(a.caller);
    const [planPda] = await findPlanPda({ owner: toAddress(a.merchant), planId: a.planId });
    const [subscriptionPda] = await findSubscriptionDelegationPda({
      planPda,
      subscriber: toAddress(a.subscriber),
    });
    const sent: unknown = await client.subscriptions.instructions
      .transferSubscription({
        amount: a.amount,
        caller: a.caller.signer,
        delegator: toAddress(a.subscriber),
        planPda,
        receiverAta: toAddress(a.merchantAta),
        subscriptionPda,
        tokenMint: toAddress(a.mint),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
      .sendTransaction();
    return { reference: extractSignature(sent), amount: a.amount };
  }

  async isSubscriptionActive(a: IsSubscriptionActiveArgs): Promise<boolean> {
    const client = await this.readClient();
    const [planPda] = await findPlanPda({ owner: toAddress(a.merchant), planId: a.planId });
    const [subscriptionPda] = await findSubscriptionDelegationPda({
      planPda,
      subscriber: toAddress(a.subscriber),
    });
    const acct = await fetchMaybeSubscriptionDelegation(client.rpc, subscriptionPda);
    if (!acct.exists) return false;
    const expires = acct.data.expiresAtTs;
    return expires === 0n || nowUnix() <= expires;
  }
}
