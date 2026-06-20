import { activeMint, config, fmtToken, serverBaseUrl } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";
import { decisionLine } from "../avoid/threatApi";

/**
 * An autonomous agent that screens tokens with Avoid.net BEFORE interacting.
 * It holds a delegated, capped, self-expiring allowance (granted by its owner)
 * and pays per threat-check, x402-style. When the budget is exhausted the pull
 * fails and the agent stops -- the on-chain cap doing its job.
 */
const WATCHLIST = [
  "Acme Exchange",
  "DrainCoin",
  "GhostBridge",
  "NovaSwap (unlisted)",
  "Acme Exchange",
  "DrainCoin",
  "GhostBridge",
];

interface Quote {
  price: string;
  payTo: string;
}

async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const agent = await loadWallet(config.keypairs.agent); // delegatee (spender)
  const user = await loadWallet(config.keypairs.user); // delegator (budget owner)
  const mint = activeMint();
  const base = serverBaseUrl();

  console.log(`Agent ${agent.address}`);
  console.log(`Budget owner (delegator): ${user.address}`);
  const before = await backend.allowanceStatus({
    delegator: user.address,
    delegatee: agent.address,
    mint,
  });
  if (!before.exists) {
    console.error("No allowance granted. Run `npm run allowance:grant` first.");
    process.exit(1);
  }
  console.log(`Allowance remaining: ${fmtToken(before.remaining)}\n`);

  let checks = 0;
  let spent = 0n;
  for (const entity of WATCHLIST) {
    const quoteRes = await fetch(`${base}/api/check?entity=${encodeURIComponent(entity)}`);
    if (quoteRes.status !== 402) {
      console.log(`  ${entity}: unexpected status ${quoteRes.status}`);
      continue;
    }
    const quote = (await quoteRes.json()) as Quote;
    const amount = BigInt(quote.price);

    let reference: string;
    try {
      const proof = await backend.payPerCall({
        delegatee: agent,
        delegator: user.address,
        mint,
        merchantAta: quote.payTo,
        amount,
      });
      reference = proof.reference;
    } catch (err) {
      console.log(`\n  ${entity}: cannot pay -> ${(err as Error).message}`);
      console.log("  Budget exhausted. Agent stops. (allowance cap enforced)\n");
      break;
    }

    const dataRes = await fetch(`${base}/api/check?entity=${encodeURIComponent(entity)}`, {
      headers: { "x-payment": reference },
    });
    if (!dataRes.ok) {
      console.log(`  ${entity}: payment rejected (${dataRes.status})`);
      continue;
    }
    const data = (await dataRes.json()) as { report: Parameters<typeof decisionLine>[0] };
    checks += 1;
    spent += amount;
    console.log(`  paid ${fmtToken(amount)}  ${decisionLine(data.report)}`);
    if (data.report.verdict === "avoid") {
      console.log(`    !! ABORTING interaction with "${entity}"`);
    }
  }

  const after = await backend.allowanceStatus({
    delegator: user.address,
    delegatee: agent.address,
    mint,
  });
  console.log(`\nDone. ${checks} checks, spent ${fmtToken(spent)}, remaining ${fmtToken(after.remaining)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
