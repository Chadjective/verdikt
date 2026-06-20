import { activeMint, config } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";

/** The user subscribes to the merchant's plan (mints their Subscription PDA). */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const subscriber = await loadWallet(config.keypairs.user);
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = activeMint();
  const planId = BigInt(process.env.PLAN_ID ?? "1");

  await backend.subscribe({ subscriber, merchant: merchant.address, planId, mint });

  console.log(`Subscribed to plan #${planId}  [${backend.kind}]`);
  console.log(`  subscriber : ${subscriber.address}`);
  console.log(`  merchant   : ${merchant.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
