import { activeMint, config, fmtToken } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/**
 * Merchant (or a whitelisted puller) charges the subscriber for the current
 * period. Recurring caps do not stack: a period can be charged at most once.
 */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const merchant = await loadWallet(config.keypairs.merchant);
  const subscriber = await loadWallet(config.keypairs.user);
  const mint = activeMint();
  const merchantAta = await backend.ataFor(merchant.address, mint);

  const planId = BigInt(process.env.PLAN_ID ?? "1");
  const amount = BigInt(process.env.PLAN_PRICE ?? "5000000");

  const proof = await backend.chargeSubscription({
    caller: merchant,
    subscriber: subscriber.address,
    merchant: merchant.address,
    planId,
    mint,
    merchantAta,
    amount,
  });

  console.log(`Charged ${fmtToken(amount)} for plan #${planId}  [${backend.kind}]`);
  console.log(`  reference : ${proof.reference}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
