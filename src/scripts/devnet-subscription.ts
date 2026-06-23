import { findPlanPda, findSubscriptionDelegationPda } from "@solana/subscriptions";
import { config } from "../config";
import { ChainPayments } from "../payments/chain";
import { buildClient, createEphemeralWallet, loadWallet, toAddress } from "../solana/client";

/**
 * One-shot devnet proof for the SUBSCRIPTION PLAN path — the third S&A
 * construct alongside fixed and recurring delegations. Mirrors the recurring
 * proof's shape: createPlan -> subscribe -> read active -> transferSubscription
 * -> read again. Because a subscription charge has no on-chain "remaining cap"
 * to read back (unlike fixed/recurring), the assertion is the strongest one
 * available: the merchant's token account received exactly the plan price.
 * Prints explorer links for all three writes.
 *
 * Run (chain mode, funded payer, TOKEN_MINT set):  npm run devnet:subscription
 */
const tx = (sig: string): string => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

type Rpc = ReturnType<typeof buildClient>["rpc"];

async function tokenBalance(rpc: Rpc, ata: string): Promise<bigint> {
  try {
    const r = await rpc.getTokenAccountBalance(toAddress(ata)).send();
    return BigInt(r.value.amount);
  } catch {
    return 0n; // ATA not yet initialized -> zero balance
  }
}

/** Surface the tx that last touched a PDA (createPlan/subscribe return void). */
async function latestSig(rpc: Rpc, addr: string): Promise<string | undefined> {
  const sigs = await rpc.getSignaturesForAddress(toAddress(addr), { limit: 1 }).send();
  return sigs[0]?.signature;
}

async function main(): Promise<void> {
  if (config.payments !== "chain") throw new Error("Set PAYMENTS=chain (and TOKEN_MINT) in .env first.");
  const chain = new ChainPayments();
  const subscriber = await loadWallet(config.keypairs.user);
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = config.tokenMint;

  const planId = BigInt(Date.now()); // unique plan PDA per run -> no PlanTermsMismatch
  const price = 10_000n; // 0.01 token / period — small, so the user ATA always covers it
  const periodHours = 720n; // ~monthly

  const rc = await createEphemeralWallet().then(buildClient);
  const merchantAta = await chain.ataFor(merchant.address, mint);
  const subscriberAta = await chain.ataFor(subscriber.address, mint);

  console.log(`Subscription plan on devnet  (planId ${planId})`);
  console.log(`  subscriber : ${subscriber.address}`);
  console.log(`  merchant   : ${merchant.address}`);
  console.log(`  mint       : ${mint}\n`);

  // Pre-flight: a subscription charge pulls real tokens from the subscriber and
  // both wallets pay rent/fees, so fail fast (before any write) if underfunded.
  const subSol = (await rc.rpc.getBalance(toAddress(subscriber.address)).send()).value;
  const merSol = (await rc.rpc.getBalance(toAddress(merchant.address)).send()).value;
  const subBal = await tokenBalance(rc.rpc, subscriberAta);
  console.log(`  subscriber: ${subSol} lamports, ${subBal} tokens (need >= ${price})`);
  console.log(`  merchant  : ${merSol} lamports\n`);
  if (subBal < price) throw new Error(`Subscriber ATA underfunded (${subBal} < ${price}). Run npm run setup:chain.`);
  if (subSol < 2_000_000n || merSol < 2_000_000n) {
    throw new Error("A signer is low on SOL. Fund user + merchant at https://faucet.solana.com (devnet).");
  }

  console.log(`createPlan (${price} / ${periodHours}h, puller = merchant)...`);
  await chain.createPlan({
    merchant,
    planId,
    mint,
    amount: price,
    periodHours,
    destinations: [merchant.address], // owner addresses; the program checks receiverAta's owner is listed
    pullers: [merchant.address],
    metadataUri: "https://avoid.net/plans/pro.json",
  });
  const [planPda] = await findPlanPda({ owner: toAddress(merchant.address), planId });
  const createSig = await latestSig(rc.rpc, planPda);
  if (createSig) console.log(`  createPlan tx -> ${tx(createSig)}`);

  console.log("\nsubscribe (mints the subscriber's Subscription PDA)...");
  await chain.subscribe({ subscriber, merchant: merchant.address, planId, mint });
  const [subPda] = await findSubscriptionDelegationPda({ planPda, subscriber: toAddress(subscriber.address) });
  const subSig = await latestSig(rc.rpc, subPda);
  if (subSig) console.log(`  subscribe tx -> ${tx(subSig)}`);

  const active = await chain.isSubscriptionActive({
    subscriber: subscriber.address,
    merchant: merchant.address,
    planId,
    mint,
  });
  console.log(`  subscription active: ${active} (expect true)`);
  if (!active) throw new Error("Subscription not active after subscribe.");

  const before = await tokenBalance(rc.rpc, merchantAta);
  console.log(`\ntransferSubscription (charge ${price} for the period)...`);
  const proof = await chain.chargeSubscription({
    caller: merchant,
    subscriber: subscriber.address,
    merchant: merchant.address,
    planId,
    mint,
    merchantAta,
    amount: price,
  });
  console.log(`  transferSubscription tx -> ${tx(proof.reference)}`);

  const after = await tokenBalance(rc.rpc, merchantAta);
  console.log(`  merchant token balance: ${before} -> ${after} (expect +${price})`);

  if (after - before !== price) {
    throw new Error(`Assertion failed: merchant received ${after - before}, expected ${price}`);
  }
  console.log(
    "\n✅ Subscription plan verified on devnet: createPlan -> subscribe -> transferSubscription moved exactly the plan price on-chain.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
