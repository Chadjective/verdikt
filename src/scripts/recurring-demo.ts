import { activeMint, config, fmtToken } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/**
 * Demonstrates the RECURRING delegation primitive end-to-end: the agent draws a
 * capped budget that REFILLS each period. It pulls until the per-period cap is
 * hit (rejected on-chain), waits one period, then pulls again successfully --
 * the defining behaviour a fixed delegation can't express.
 *
 * Uses a short period (RECURRING_PERIOD_S, default 3s) so the refill is visible
 * in a few seconds. Runs in mock mode by default; PAYMENTS=chain hits devnet.
 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const user = await loadWallet(config.keypairs.user);
  const agent = await loadWallet(config.keypairs.agent);
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = activeMint();
  const merchantAta = await backend.ataFor(merchant.address, mint);

  const periodS = Number(process.env.RECURRING_PERIOD_S ?? "3");
  const perPeriod = BigInt(process.env.RECURRING_ALLOWANCE ?? "30000"); // 0.03
  const price = BigInt(config.pricePerCheck); // 0.01 per check

  const now = Math.floor(Date.now() / 1000);
  await backend.grantRecurringAllowance({
    delegator: user,
    delegatee: agent.address,
    mint,
    amountPerPeriod: perPeriod,
    periodLengthS: BigInt(periodS),
    startUnix: BigInt(now),
    expiryUnix: BigInt(now + 86400),
  });

  console.log(`Recurring delegation  [${backend.kind}]`);
  console.log(`  budget: ${fmtToken(perPeriod)} per ${periodS}s, at ${fmtToken(price)}/check\n`);

  const pull = async (label: string): Promise<void> => {
    try {
      await backend.payPerPeriod({ delegatee: agent, delegator: user.address, mint, merchantAta, amount: price });
      const s = await backend.recurringStatus({ delegator: user.address, delegatee: agent.address, mint });
      console.log(`  paid ${fmtToken(price)} [check]  ${label} -- remaining this period: ${fmtToken(s.remaining)}`);
    } catch (err) {
      console.log(`  !! ${label} REJECTED -- ${(err as Error).message}`);
    }
  };

  console.log("Period 1: spend the budget, then try to overspend");
  await pull("check 1");
  await pull("check 2");
  await pull("check 3");
  await pull("check 4 (over cap)");

  console.log(`\nWaiting one period (${periodS}s) for the budget to refill...\n`);
  await sleep(periodS * 1000 + 500);

  console.log("Period 2: the cap has refilled on its own");
  await pull("check 1");

  const s = await backend.recurringStatus({ delegator: user.address, delegatee: agent.address, mint });
  console.log(`\nRemaining this period: ${fmtToken(s.remaining)} -- no human in the loop, cap enforced by the delegation.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
