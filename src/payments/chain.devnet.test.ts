import { describe, expect, it } from "vitest";
import { config } from "../config";
import { ChainPayments } from "./chain";
import { loadWallet } from "../solana/client";

/**
 * Real on-chain integration test against the live Subscriptions & Allowances
 * program on devnet. Exercises the actual ChainPayments code path:
 *   grant fixed delegation -> read on-chain cap -> transferFixed -> read again,
 * asserting the program decremented the cap by exactly the pulled amount.
 *
 * Skipped unless chain mode is configured with a funded payer + a TOKEN_MINT:
 *   1. Fund the user wallet with devnet SOL (https://faucet.solana.com)
 *   2. `npm run setup` then `npm run setup:chain` (prints TOKEN_MINT)
 *   3. .env: PAYMENTS=chain, RPC_URL=https://api.devnet.solana.com, TOKEN_MINT=...
 *   4. `npm run test:chain`
 */
const RUN = config.payments === "chain" && config.tokenMint.length > 0;

describe.skipIf(!RUN)("ChainPayments — devnet integration", () => {
  it(
    "decrements the fixed-delegation cap by the pulled amount, on-chain",
    async () => {
      const chain = new ChainPayments();
      const user = await loadWallet(config.keypairs.user);
      const agent = await loadWallet(config.keypairs.agent);
      const merchant = await loadWallet(config.keypairs.merchant);
      const mint = config.tokenMint;

      const cap = 50_000n;
      const pull = 10_000n;
      const nonce = BigInt(Date.now()); // unique delegation PDA per run
      const expiryUnix = BigInt(Math.floor(Date.now() / 1000) + 3600);

      await chain.grantAllowance({ delegator: user, delegatee: agent.address, mint, amount: cap, expiryUnix, nonce });

      const before = await chain.allowanceStatus({ delegator: user.address, delegatee: agent.address, mint, nonce });
      expect(before.exists).toBe(true);
      expect(before.remaining).toBe(cap);

      const merchantAta = await chain.ataFor(merchant.address, mint);
      await chain.payPerCall({ delegatee: agent, delegator: user.address, mint, merchantAta, amount: pull, nonce });

      const after = await chain.allowanceStatus({ delegator: user.address, delegatee: agent.address, mint, nonce });
      expect(after.remaining).toBe(cap - pull);
    },
    180_000,
  );

  it(
    "decrements the recurring per-period cap by the pulled amount, on-chain",
    async () => {
      const chain = new ChainPayments();
      const user = await loadWallet(config.keypairs.user);
      const agent = await loadWallet(config.keypairs.agent);
      const merchant = await loadWallet(config.keypairs.merchant);
      const mint = config.tokenMint;

      const cap = 50_000n;
      const pull = 10_000n;
      const nonce = BigInt(Date.now()); // unique recurring delegation PDA per run
      const now = Math.floor(Date.now() / 1000);
      const startUnix = BigInt(now + 10); // future start dodges START_TIME_IN_PAST on confirm latency
      const expiryUnix = BigInt(now + 7200);

      await chain.grantRecurringAllowance({
        delegator: user,
        delegatee: agent.address,
        mint,
        amountPerPeriod: cap,
        periodLengthS: 3600n,
        startUnix,
        expiryUnix,
        nonce,
      });

      const before = await chain.recurringStatus({ delegator: user.address, delegatee: agent.address, mint, nonce });
      expect(before.exists).toBe(true);
      expect(before.remaining).toBe(cap);

      await new Promise((r) => setTimeout(r, 13_000)); // wait past the start time

      const merchantAta = await chain.ataFor(merchant.address, mint);
      await chain.payPerPeriod({ delegatee: agent, delegator: user.address, mint, merchantAta, amount: pull, nonce });

      const after = await chain.recurringStatus({ delegator: user.address, delegatee: agent.address, mint, nonce });
      expect(after.remaining).toBe(cap - pull);
    },
    180_000,
  );
});
