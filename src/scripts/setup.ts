import { promises as fs } from "node:fs";
import { lamports } from "@solana/kit";
import { config } from "../config";
import { buildClient, createAndSaveWallet, loadWallet, toAddress, type Wallet } from "../solana/client";

async function ensureWallet(label: string, path: string): Promise<Wallet> {
  try {
    const w = await loadWallet(path);
    console.log(`  ${label}: ${w.address} (existing)`);
    return w;
  } catch {
    const w = await createAndSaveWallet(path);
    console.log(`  ${label}: ${w.address} (created)`);
    return w;
  }
}

async function main(): Promise<void> {
  console.log(`Setup  [${config.payments} mode]`);
  const user = await ensureWallet("user/subscriber", config.keypairs.user);
  const agent = await ensureWallet("agent         ", config.keypairs.agent);
  const merchant = await ensureWallet("merchant      ", config.keypairs.merchant);

  if (config.payments === "mock") {
    try {
      await fs.rm(process.env.MOCK_LEDGER ?? ".keys/mock-ledger.json");
    } catch {
      /* no ledger yet */
    }
    console.log("\nMock mode ready (fresh ledger). Next:");
    console.log("  npm run allowance:grant   # fund the agent's budget (fixed delegation)");
    console.log("  npm run recurring:demo    # per-period refilling budget (recurring delegation)");
    console.log("  npm run plan:create       # publish a subscription plan");
    console.log("  npm run server            # in a separate terminal");
    console.log("  npm run agent             # watch the agent pay per check");
    return;
  }

  console.log("\nAirdropping devnet SOL (for fees + rent)...");
  for (const [label, w] of [
    ["user", user],
    ["agent", agent],
    ["merchant", merchant],
  ] as const) {
    try {
      const client = buildClient(w);
      await client.rpc.requestAirdrop(toAddress(w.address), lamports(1_000_000_000n)).send();
      console.log(`  +1 SOL -> ${label}`);
    } catch (err) {
      console.log(`  airdrop failed for ${label} (devnet limits): ${(err as Error).message}`);
    }
  }

  console.log("\nCreate a plain-SPL test token (6 decimals) and fund the user, then set TOKEN_MINT:");
  console.log("  spl-token create-token --decimals 6 --url devnet");
  console.log(`  spl-token create-account <MINT> --owner ${user.address} --url devnet`);
  console.log(`  spl-token mint <MINT> 100 --recipient-owner ${user.address} --url devnet`);
  console.log(`  spl-token create-account <MINT> --owner ${merchant.address} --url devnet`);
  console.log("  # then in .env: PAYMENTS=chain and TOKEN_MINT=<MINT>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
