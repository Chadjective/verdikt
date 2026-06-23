import { afterAll, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { MockPayments } from "./mock";
import type { Wallet } from "../solana/client";

const w = (address: string): Wallet => ({ address, signer: {} as unknown as Wallet["signer"] });
const USER = w("User1111");
const AGENT = w("Agent1111");
const MERCHANT = w("Merchant1111");
const MINT = "Mint1111";

const tmpFiles: string[] = [];
beforeEach(() => {
  const p = path.join(os.tmpdir(), `verdikt-ledger-${process.hrtime.bigint()}.json`);
  process.env.MOCK_LEDGER = p;
  tmpFiles.push(p);
});
afterAll(async () => {
  for (const f of tmpFiles) {
    try {
      await fs.rm(f);
    } catch {
      /* ignore */
    }
  }
});

describe("MockPayments — allowance flow", () => {
  it("grants and reports an allowance", async () => {
    const m = new MockPayments();
    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 1000n, expiryUnix: 0n });
    const s = await m.allowanceStatus({ delegator: USER.address, delegatee: AGENT.address, mint: MINT });
    expect(s.exists).toBe(true);
    expect(s.remaining).toBe(1000n);
  });

  it("reports a non-existent allowance", async () => {
    const m = new MockPayments();
    const s = await m.allowanceStatus({ delegator: USER.address, delegatee: AGENT.address, mint: MINT });
    expect(s.exists).toBe(false);
    expect(s.remaining).toBe(0n);
  });

  it("decrements on payPerCall and yields a verifiable proof", async () => {
    const m = new MockPayments();
    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 100n, expiryUnix: 0n });
    const ata = await m.ataFor(MERCHANT.address, MINT);
    const proof = await m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 30n });
    expect(proof.amount).toBe(30n);
    const s = await m.allowanceStatus({ delegator: USER.address, delegatee: AGENT.address, mint: MINT });
    expect(s.remaining).toBe(70n);
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 30n, merchantAta: ata, mint: MINT })).toBe(true);
  });

  it("throws on insufficient, missing, or expired allowance", async () => {
    const m = new MockPayments();
    const ata = await m.ataFor(MERCHANT.address, MINT);
    await expect(
      m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 1n }),
    ).rejects.toThrow();

    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 10n, expiryUnix: 0n });
    await expect(
      m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 50n }),
    ).rejects.toThrow();

    const past = BigInt(Math.floor(Date.now() / 1000) - 10);
    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 100n, expiryUnix: past });
    await expect(
      m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 1n }),
    ).rejects.toThrow(/expired/i);
  });
});

describe("MockPayments — verifyPayment", () => {
  it("rejects a replayed proof", async () => {
    const m = new MockPayments();
    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 100n, expiryUnix: 0n });
    const ata = await m.ataFor(MERCHANT.address, MINT);
    const proof = await m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 10n });
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 10n, merchantAta: ata, mint: MINT })).toBe(true);
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 10n, merchantAta: ata, mint: MINT })).toBe(false);
  });

  it("rejects wrong merchant, wrong mint, underpayment, and unknown proofs without consuming the proof", async () => {
    const m = new MockPayments();
    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 100n, expiryUnix: 0n });
    const ata = await m.ataFor(MERCHANT.address, MINT);
    const proof = await m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 10n });
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 10n, merchantAta: "other", mint: MINT })).toBe(false);
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 10n, merchantAta: ata, mint: "OtherMint" })).toBe(false);
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 11n, merchantAta: ata, mint: MINT })).toBe(false);
    expect(await m.verifyPayment({ proof: "does-not-exist", minAmount: 1n, merchantAta: ata, mint: MINT })).toBe(false);
    // The proof was never consumed by the failed checks, so a correct verify still succeeds.
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 10n, merchantAta: ata, mint: MINT })).toBe(true);
  });
});

describe("MockPayments — two concurrent delegations off one account", () => {
  it("tracks user->agent and user->merchant independently", async () => {
    const m = new MockPayments();
    await m.grantAllowance({ delegator: USER, delegatee: AGENT.address, mint: MINT, amount: 50n, expiryUnix: 0n });
    await m.grantAllowance({ delegator: USER, delegatee: MERCHANT.address, mint: MINT, amount: 200n, expiryUnix: 0n });
    const ata = await m.ataFor(MERCHANT.address, MINT);

    await m.payPerCall({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 50n });
    expect((await m.allowanceStatus({ delegator: USER.address, delegatee: AGENT.address, mint: MINT })).remaining).toBe(0n);
    expect((await m.allowanceStatus({ delegator: USER.address, delegatee: MERCHANT.address, mint: MINT })).remaining).toBe(200n);

    await m.payPerCall({ delegatee: MERCHANT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 120n });
    expect((await m.allowanceStatus({ delegator: USER.address, delegatee: MERCHANT.address, mint: MINT })).remaining).toBe(80n);
  });
});

describe("MockPayments — recurring delegation", () => {
  const grant = (m: MockPayments, amountPerPeriod: bigint, periodLengthS: bigint) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return m.grantRecurringAllowance({
      delegator: USER,
      delegatee: AGENT.address,
      mint: MINT,
      amountPerPeriod,
      periodLengthS,
      startUnix: now,
      expiryUnix: now + 3600n,
    });
  };

  it("grants and reports a per-period budget", async () => {
    const m = new MockPayments();
    await grant(m, 30n, 60n);
    const s = await m.recurringStatus({ delegator: USER.address, delegatee: AGENT.address, mint: MINT });
    expect(s.exists).toBe(true);
    expect(s.remaining).toBe(30n);
  });

  it("decrements within a period and enforces the per-period cap", async () => {
    const m = new MockPayments();
    await grant(m, 30n, 60n);
    const ata = await m.ataFor(MERCHANT.address, MINT);
    await m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 10n });
    await m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 20n });
    expect((await m.recurringStatus({ delegator: USER.address, delegatee: AGENT.address, mint: MINT })).remaining).toBe(0n);
    // The next pull this period exceeds the cap.
    await expect(
      m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 1n }),
    ).rejects.toThrow(/per-period cap/i);
  });

  it("refills the cap when a new period begins", async () => {
    const m = new MockPayments();
    await grant(m, 30n, 1n); // 1-second period
    const ata = await m.ataFor(MERCHANT.address, MINT);
    await m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 30n });
    await expect(
      m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 1n }),
    ).rejects.toThrow(/per-period cap/i);
    await new Promise((r) => setTimeout(r, 1300)); // cross the period boundary
    const proof = await m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 30n });
    expect(proof.amount).toBe(30n);
  });

  it("yields a proof verifiable through the existing verifyPayment path", async () => {
    const m = new MockPayments();
    await grant(m, 30n, 60n);
    const ata = await m.ataFor(MERCHANT.address, MINT);
    const proof = await m.payPerPeriod({ delegatee: AGENT, delegator: USER.address, mint: MINT, merchantAta: ata, amount: 10n });
    expect(await m.verifyPayment({ proof: proof.reference, minAmount: 10n, merchantAta: ata, mint: MINT })).toBe(true);
  });
});

describe("MockPayments — subscription flow", () => {
  const plan = { merchant: MERCHANT, planId: 1n, mint: MINT, amount: 500n, periodHours: 720n, destinations: ["x"], pullers: ["y"], metadataUri: "u" };

  it("runs create -> subscribe -> active -> charge", async () => {
    const m = new MockPayments();
    await m.createPlan(plan);
    expect(await m.isSubscriptionActive({ subscriber: USER.address, merchant: MERCHANT.address, planId: 1n, mint: MINT })).toBe(false);
    await m.subscribe({ subscriber: USER, merchant: MERCHANT.address, planId: 1n, mint: MINT });
    expect(await m.isSubscriptionActive({ subscriber: USER.address, merchant: MERCHANT.address, planId: 1n, mint: MINT })).toBe(true);
    const ata = await m.ataFor(MERCHANT.address, MINT);
    const proof = await m.chargeSubscription({ caller: MERCHANT, subscriber: USER.address, merchant: MERCHANT.address, planId: 1n, mint: MINT, merchantAta: ata, amount: 500n });
    expect(proof.amount).toBe(500n);
  });

  it("rejects subscribe without a plan and charge without a subscription", async () => {
    const m = new MockPayments();
    await expect(m.subscribe({ subscriber: USER, merchant: MERCHANT.address, planId: 9n, mint: MINT })).rejects.toThrow();
    await m.createPlan(plan);
    const ata = await m.ataFor(MERCHANT.address, MINT);
    await expect(
      m.chargeSubscription({ caller: MERCHANT, subscriber: USER.address, merchant: MERCHANT.address, planId: 1n, mint: MINT, merchantAta: ata, amount: 500n }),
    ).rejects.toThrow();
  });

  it("does not double-charge the same period", async () => {
    const m = new MockPayments();
    await m.createPlan(plan);
    await m.subscribe({ subscriber: USER, merchant: MERCHANT.address, planId: 1n, mint: MINT });
    const ata = await m.ataFor(MERCHANT.address, MINT);
    await m.chargeSubscription({ caller: MERCHANT, subscriber: USER.address, merchant: MERCHANT.address, planId: 1n, mint: MINT, merchantAta: ata, amount: 500n });
    await expect(
      m.chargeSubscription({ caller: MERCHANT, subscriber: USER.address, merchant: MERCHANT.address, planId: 1n, mint: MINT, merchantAta: ata, amount: 500n }),
    ).rejects.toThrow(/already charged/i);
  });
});
