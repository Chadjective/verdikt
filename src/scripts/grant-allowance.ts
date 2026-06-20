import { activeMint, config, fmtToken } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/**
 * The user (delegator) grants the agent (delegatee) a capped, self-expiring
 * allowance. Default 0.05 token = 5 checks at the default 0.01 price, so the
 * agent run visibly exhausts its budget.
 */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const user = await loadWallet(config.keypairs.user);
  const agent = await loadWallet(config.keypairs.agent);
  const mint = activeMint();

  const amount = BigInt(process.env.ALLOWANCE_AMOUNT ?? "50000");
  const days = Number(process.env.ALLOWANCE_DAYS ?? "7");
  const expiryUnix = BigInt(Math.floor(Date.now() / 1000) + days * 86400);

  await backend.grantAllowance({ delegator: user, delegatee: agent.address, mint, amount, expiryUnix });

  console.log(`Granted allowance ${fmtToken(amount)} (expires in ${days}d)  [${backend.kind}]`);
  console.log(`  delegator (budget) : ${user.address}`);
  console.log(`  delegatee (agent)  : ${agent.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
