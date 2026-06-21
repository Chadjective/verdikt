import express from "express";
import { activeMint, config, fmtToken, serverBaseUrl, TOKEN_DECIMALS } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";
import { investigate, lookup, type ThreatReport } from "../avoid/threatApi";
import { createAnchor } from "../anchor";

/**
 * Avoid.net metered threat API. Two settlement models on one allowance rail:
 *
 *   GET /api/check?entity=...          cached verdict, PRE-PAY (x402)
 *     - known + no x-payment -> 402 + { price, payTo }
 *     - known + x-payment    -> verify allowance pull, return cached report
 *     - unknown              -> 404 + pointer to /api/investigate
 *
 *   GET /api/investigate?entity=...    on-demand investigation, PAY-ON-COMPLETION
 *     - x-budget: <allowance owner>; server runs the investigation and pulls
 *       from the user's allowance ONLY if it succeeds (Avoid.net is delegatee).
 *
 *   GET /api/check/subscription?entity=...   active plan; lookups + investigations included
 */
async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const merchant = await loadWallet(config.keypairs.merchant).catch(() => {
    console.error("No merchant keypair. Run `npm run setup` first.");
    return process.exit(1);
  });

  const mint = activeMint();
  const merchantAta = await backend.ataFor(merchant.address, mint);
  const checkPrice = config.pricePerCheck;
  const investigationPrice = config.pricePerInvestigation;
  const anchor = createAnchor();

  // Anchor the verdict's content hash (best-effort); returns the receipt or undefined.
  const anchorOf = async (report: ThreatReport) => {
    try {
      return await anchor.anchor(report.contentHash);
    } catch {
      return undefined;
    }
  };

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: backend.kind,
      merchant: merchant.address,
      merchantAta,
      mint,
      checkPrice: checkPrice.toString(),
      investigationPrice: investigationPrice.toString(),
    });
  });

  // --- Cached verdict: pre-pay (x402), agent is the delegatee ---
  app.get("/api/check", async (req, res) => {
    const entity = String(req.query.entity ?? "");
    if (!entity) {
      res.status(400).json({ error: "missing ?entity=" });
      return;
    }
    const hit = lookup(entity);
    if (!hit) {
      res.status(404).json({
        error: "no cached intel for this entity",
        investigate: {
          endpoint: "/api/investigate",
          price: investigationPrice.toString(),
          priceDisplay: fmtToken(investigationPrice),
          header: "x-budget: <allowance owner address>",
        },
        hint: "Commission an on-demand investigation (pay-on-completion).",
      });
      return;
    }
    const proof = req.header("x-payment");
    if (!proof) {
      res.status(402).json({
        error: "payment required",
        scheme: "solana-allowance",
        price: checkPrice.toString(),
        priceDisplay: fmtToken(checkPrice),
        mint,
        payTo: merchantAta,
        decimals: TOKEN_DECIMALS,
        hint: "Pay from your allowance, then retry with header `x-payment: <reference>`.",
      });
      return;
    }
    const ok = await backend.verifyPayment({ proof, minAmount: checkPrice, merchantAta, mint });
    if (!ok) {
      res.status(402).json({ error: "invalid or already-used payment", scheme: "solana-allowance" });
      return;
    }
    res.json({ paid: true, tier: "cache", reference: proof, report: hit, anchor: await anchorOf(hit) });
  });

  // --- On-demand investigation: pay-on-completion, Avoid.net is the delegatee ---
  app.get("/api/investigate", async (req, res) => {
    const entity = String(req.query.entity ?? "");
    const budgetOwner = req.header("x-budget");
    if (!entity) {
      res.status(400).json({ error: "missing ?entity=" });
      return;
    }
    if (!budgetOwner) {
      res.status(401).json({ error: "missing x-budget header (allowance owner address)" });
      return;
    }

    // 1. Check the user's investigation allowance BEFORE spending compute.
    const status = await backend.allowanceStatus({
      delegator: budgetOwner,
      delegatee: merchant.address,
      mint,
    });
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expired = status.expiresUnix !== 0n && now > status.expiresUnix;
    if (!status.exists || expired || status.remaining < investigationPrice) {
      res.status(402).json({
        error: "insufficient investigation allowance",
        need: investigationPrice.toString(),
        have: status.remaining.toString(),
        hint: "Grant Avoid.net an allowance via `npm run allowance:grant`.",
      });
      return;
    }

    // 2. Run the investigation (the billable compute).
    let report;
    try {
      report = await investigate(entity, config.investigationMs);
    } catch (err) {
      res.status(500).json({ error: `investigation failed: ${(err as Error).message}` });
      return;
    }

    // 3. Charge ONLY on success: the server pulls from the allowance as delegatee.
    try {
      const proof = await backend.payPerCall({
        delegatee: merchant,
        delegator: budgetOwner,
        mint,
        merchantAta,
        amount: investigationPrice,
      });
      res.json({
        paid: true,
        tier: "investigation",
        charged: investigationPrice.toString(),
        reference: proof.reference,
        report,
        anchor: await anchorOf(report),
      });
    } catch (err) {
      res.status(402).json({ error: `payment failed after investigation: ${(err as Error).message}` });
    }
  });

  // --- Human route: active subscription includes lookups + investigations ---
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
      res.status(402).json({ error: "no active subscription", hint: "Run `npm run plan:subscribe`." });
      return;
    }
    const report = lookup(entity) ?? (await investigate(entity, config.investigationMs));
    res.json({ subscriber, tier: "subscription", report, anchor: await anchorOf(report) });
  });

  app.listen(config.port, () => {
    console.log(`Avoid.net metered API  [${backend.kind} mode]  ${serverBaseUrl()}`);
    console.log(`  merchant : ${merchant.address}`);
    console.log(`  payTo    : ${merchantAta}`);
    console.log(`  mint     : ${mint}`);
    console.log(`  check    : ${fmtToken(checkPrice)}  (cached, pre-pay / x402)`);
    console.log(`  investig.: ${fmtToken(investigationPrice)}  (on-demand, pay-on-completion)`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
