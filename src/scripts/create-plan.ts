import { activeMint, config, fmtToken } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/** Merchant (Avoid.net) publishes a subscription plan: a recurring API tier. */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = activeMint();
  const merchantAta = await backend.ataFor(merchant.address, mint);

  const planId = BigInt(process.env.PLAN_ID ?? "1");
  const amount = BigInt(process.env.PLAN_PRICE ?? "5000000"); // 5.0 / period
  const periodHours = BigInt(process.env.PLAN_PERIOD_HOURS ?? "720"); // ~monthly

  await backend.createPlan({
    merchant,
    planId,
    mint,
    amount,
    periodHours,
    destinations: [merchant.address], // destination *owners* — the program checks each charge's receiverAta is owned by one
    pullers: [merchant.address],
    metadataUri: "https://avoid.net/plans/pro.json",
  });

  console.log(`Created plan #${planId}: ${fmtToken(amount)} / ${periodHours}h  [${backend.kind}]`);
  console.log(`  merchant : ${merchant.address}`);
  console.log(`  payTo    : ${merchantAta}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
