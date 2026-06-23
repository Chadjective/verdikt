import { activeMint, config, fmtToken } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/**
 * Grant a RECURRING delegation (the third Subscriptions & Allowances construct,
 * alongside the fixed delegation in `grant-allowance` and the subscription plan).
 *
 * Unlike a fixed delegation (a one-shot cap that drains and dies), a recurring
 * delegation refills `amountPerPeriod` every `periodLengthS` -- the natural fit
 * for a long-running agent's recurring spend (e.g. a daily check budget).
 *
 * Defaults: 0.03 per period (3 @ 0.01), 1-day period, 7-day expiry.
 */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const user = await loadWallet(config.keypairs.user);
  const agent = await loadWallet(config.keypairs.agent);
  const mint = activeMint();

  const now = Math.floor(Date.now() / 1000);
  const periodS = BigInt(process.env.RECURRING_PERIOD_S ?? "86400"); // 1 day
  const amountPerPeriod = BigInt(process.env.RECURRING_ALLOWANCE ?? "30000"); // 0.03
  const days = Number(process.env.ALLOWANCE_DAYS ?? "7");
  const expiryUnix = BigInt(now + days * 86400);

  await backend.grantRecurringAllowance({
    delegator: user,
    delegatee: agent.address,
    mint,
    amountPerPeriod,
    periodLengthS: periodS,
    startUnix: BigInt(now),
    expiryUnix,
  });

  console.log(`Granted a recurring delegation (refills each period)  [${backend.kind}]`);
  console.log(`  user -> agent       : ${fmtToken(amountPerPeriod)} per ${periodS}s period`);
  console.log(`  expires in          : ${days}d`);
  console.log(`  delegator           : ${user.address}`);
  console.log(`  agent (delegatee)   : ${agent.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
