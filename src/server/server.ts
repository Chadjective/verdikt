import express from "express";
import { activeMint, config, fmtToken, serverBaseUrl, TOKEN_DECIMALS } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";
import { checkEntity } from "../avoid/threatApi";

/**
 * Avoid.net metered threat API.
 *
 *   GET /api/check?entity=...               (agent route, x402-style)
 *     - no payment      -> 402 + { price, payTo, mint }  (HTTP 402 Payment Required)
 *     - x-payment: <ref> -> verify allowance pull, then return the threat report
 *
 *   GET /api/check/subscription?entity=...  (human route)
 *     - x-subscriber: <addr> -> gated by an active subscription plan
 */
async function main(): Promise<void> {
  const backend = createPaymentBackend();

  let merchant;
  try {
    merchant = await loadWallet(config.keypairs.merchant);
  } catch {
    console.error("No merchant keypair found. Run `npm run setup` first.");
    process.exit(1);
  }

  const mint = activeMint();
  const merchantAta = await backend.ataFor(merchant.address, mint);
  const price = config.pricePerCheck;

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, mode: backend.kind, merchant: merchant.address, merchantAta, mint });
  });

  // --- Agent route: pay-per-call via allowance (x402-style) ---
  app.get("/api/check", async (req, res) => {
    const entity = String(req.query.entity ?? "");
    if (!entity) {
      res.status(400).json({ error: "missing ?entity=" });
      return;
    }
    const proof = req.header("x-payment");
    if (!proof) {
      res.status(402).json({
        error: "payment required",
        scheme: "solana-allowance",
        price: price.toString(),
        priceDisplay: fmtToken(price),
        mint,
        payTo: merchantAta,
        decimals: TOKEN_DECIMALS,
        hint: "Pay via your Solana allowance, then retry with header `x-payment: <reference>`.",
      });
      return;
    }
    const ok = await backend.verifyPayment({ proof, minAmount: price, merchantAta, mint });
    if (!ok) {
      res.status(402).json({ error: "invalid or already-used payment", scheme: "solana-allowance" });
      return;
    }
    res.json({ paid: true, reference: proof, report: checkEntity(entity) });
  });

  // --- Human route: gated by an active subscription plan ---
  app.get("/api/check/subscription", async (req, res) => {
    const entity = String(req.query.entity ?? "");
    const subscriber = req.header("x-subscriber");
    const planId = BigInt(req.header("x-plan-id") ?? "1");
    if (!entity) {
      res.status(400).json({ error: "missing ?entity=" });
      return;
    }
    if (!subscriber) {
      res.status(401).json({ error: "missing x-subscriber header" });
      return;
    }
    const active = await backend.isSubscriptionActive({
      subscriber,
      merchant: merchant.address,
      planId,
      mint,
    });
    if (!active) {
      res.status(402).json({
        error: "no active subscription",
        plan: { merchant: merchant.address, planId: planId.toString() },
        hint: "Subscribe with `npm run plan:subscribe`, then retry.",
      });
      return;
    }
    res.json({ subscriber, report: checkEntity(entity) });
  });

  app.listen(config.port, () => {
    console.log(`Avoid.net metered API  [${backend.kind} mode]  ${serverBaseUrl()}`);
    console.log(`  merchant : ${merchant.address}`);
    console.log(`  payTo    : ${merchantAta}`);
    console.log(`  mint     : ${mint}`);
    console.log(`  price    : ${fmtToken(price)} / check`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
