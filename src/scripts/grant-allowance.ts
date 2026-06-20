import { activeMint, config, fmtToken } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/**
 * The user grants TWO delegations off one SubscriptionAuthority (one token
 * account) -- which raw SPL `approve` cannot do (it allows one delegate only):
 *   - user -> agent      : capped budget for instant cached checks (x402 pre-pay)
 *   - user -> Avoid.net  : capped budget for on-demand investigations (pay-on-completion)
 * Defaults: 0.05 checks (5 @ 0.01) and 0.20 investigations (2 @ 0.10), so both
 * caps are visibly enforced during the agent run.
 */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const user = await loadWallet(config.keypairs.user);
  const agent = await loadWallet(config.keypairs.agent);
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = activeMint();

  const days = Number(process.env.ALLOWANCE_DAYS ?? "7");
  const expiryUnix = BigInt(Math.floor(Date.now() / 1000) + days * 86400);
  const checkAmount = BigInt(process.env.CHECK_ALLOWANCE ?? process.env.ALLOWANCE_AMOUNT ?? "50000");
  const investigationAmount = BigInt(process.env.INVESTIGATION_ALLOWANCE ?? "200000");

  await backend.grantAllowance({ delegator: user, delegatee: agent.address, mint, amount: checkAmount, expiryUnix });
  await backend.grantAllowance({
    delegator: user,
    delegatee: merchant.address,
    mint,
    amount: investigationAmount,
    expiryUnix,
  });

  console.log(`Granted 2 delegations off one token account (expires in ${days}d)  [${backend.kind}]`);
  console.log(`  user -> agent      : ${fmtToken(checkAmount)}  (cached checks)`);
  console.log(`  user -> Avoid.net  : ${fmtToken(investigationAmount)}  (on-demand investigations)`);
  console.log(`  delegator : ${user.address}`);
  console.log(`  agent     : ${agent.address}`);
  console.log(`  Avoid.net : ${merchant.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
