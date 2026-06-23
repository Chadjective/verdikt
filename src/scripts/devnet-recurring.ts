import { findRecurringDelegationPda, findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { config } from "../config";
import { ChainPayments } from "../payments/chain";
import { buildClient, createEphemeralWallet, loadWallet, toAddress } from "../solana/client";

/**
 * One-shot devnet proof for the RECURRING delegation path. Mirrors the fixed
 * devnet test: grant -> read cap -> transferRecurring -> read again, asserting
 * the per-period accounting decremented on-chain. Prints explorer links.
 *
 * Run (chain mode, funded payer, TOKEN_MINT set):  npm run devnet:recurring
 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const tx = (sig: string): string => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function main(): Promise<void> {
  if (config.payments !== "chain") throw new Error("Set PAYMENTS=chain (and TOKEN_MINT) in .env first.");
  const chain = new ChainPayments();
  const user = await loadWallet(config.keypairs.user);
  const agent = await loadWallet(config.keypairs.agent);
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = config.tokenMint;

  const cap = 50_000n;
  const pull = 10_000n;
  const nonce = BigInt(Date.now()); // unique recurring PDA per run
  const now = Math.floor(Date.now() / 1000);
  const startUnix = BigInt(now + 10); // future start dodges START_TIME_IN_PAST on confirm latency
  const expiryUnix = BigInt(now + 7200);

  console.log(`Recurring delegation on devnet  (nonce ${nonce})`);
  console.log(`  user   : ${user.address}`);
  console.log(`  agent  : ${agent.address}`);
  console.log(`  mint   : ${mint}\n`);

  console.log("createRecurringDelegation (cap 0.05 / period 1h)...");
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

  // Best-effort: surface the create tx by reading the new PDA's latest signature.
  try {
    const rc = await createEphemeralWallet().then(buildClient);
    const [authority] = await findSubscriptionAuthorityPda({ user: toAddress(user.address), tokenMint: toAddress(mint) });
    const [pda] = await findRecurringDelegationPda({
      subscriptionAuthority: authority,
      delegator: toAddress(user.address),
      delegatee: toAddress(agent.address),
      nonce,
    });
    const sigs = await rc.rpc.getSignaturesForAddress(pda, { limit: 1 }).send();
    if (sigs[0]) console.log(`  create tx -> ${tx(sigs[0].signature)}`);
  } catch {
    /* non-fatal: the pull tx below is the primary proof */
  }

  const before = await chain.recurringStatus({ delegator: user.address, delegatee: agent.address, mint, nonce });
  console.log(`  remaining this period: ${before.remaining} (expect ${cap})`);

  console.log(`\nWaiting for start time, then transferRecurring (pull ${pull})...`);
  await sleep(13_000);

  const merchantAta = await chain.ataFor(merchant.address, mint);
  const proof = await chain.payPerPeriod({ delegatee: agent, delegator: user.address, mint, merchantAta, amount: pull, nonce });
  console.log(`  transferRecurring tx -> ${tx(proof.reference)}`);

  const after = await chain.recurringStatus({ delegator: user.address, delegatee: agent.address, mint, nonce });
  console.log(`  remaining this period: ${after.remaining} (expect ${cap - pull})`);

  if (after.remaining !== cap - pull) {
    throw new Error(`Assertion failed: expected ${cap - pull}, got ${after.remaining}`);
  }
  console.log("\n✅ Recurring delegation verified on devnet: per-period cap decremented by the pulled amount.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
