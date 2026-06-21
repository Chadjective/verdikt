import { activeMint, config, fmtToken, serverBaseUrl } from "../config";
import { createPaymentBackend } from "../payments";
import { loadWallet } from "../solana/client";
import { decisionLine, type ThreatReport } from "../avoid/threatApi";

/**
 * An autonomous agent that screens tokens with Avoid.net BEFORE interacting.
 * It draws on TWO delegated budgets (one token account, two delegations -- the
 * thing raw SPL `approve` cannot do):
 *   - user -> agent      : instant cached checks, agent pays per call (x402)
 *   - user -> Avoid.net  : on-demand investigations, server pulls on completion
 * When a budget is exhausted the pull fails and the agent moves on.
 */
const WATCHLIST = [
  "Acme Exchange", // known  -> cache
  "DrainCoin", // known  -> cache (avoid)
  "PhantomYield", // unknown -> investigation
  "GhostBridge", // known  -> cache (avoid)
  "NovaSwap", // unknown -> investigation
  "ZyptoVault", // unknown -> investigation (budget likely spent)
  "DrainCoin", // known  -> cache
];

interface CheckQuote {
  price: string;
  payTo: string;
}

interface AnchorInfo {
  reference: string;
  explorerUrl?: string;
}

function logResult(entity: string, amount: bigint, tier: string, rep: ThreatReport, anchor?: AnchorInfo): void {
  console.log(`  paid ${fmtToken(amount)} [${tier}]  ${decisionLine(rep)}`);
  if (anchor) {
    console.log(`       anchored ${rep.contentHash.slice(0, 12)}.. -> ${anchor.explorerUrl ?? anchor.reference}`);
  }
  if (rep.verdict === "avoid") console.log(`    !! ABORTING interaction with "${entity}"`);
}

async function main(): Promise<void> {
  const backend = createPaymentBackend();
  const agent = await loadWallet(config.keypairs.agent);
  const user = await loadWallet(config.keypairs.user);
  const merchant = await loadWallet(config.keypairs.merchant);
  const mint = activeMint();
  const base = serverBaseUrl();

  console.log(`Agent ${agent.address}`);
  console.log(`Budget owner (delegator): ${user.address}`);
  const checkBudget = await backend.allowanceStatus({ delegator: user.address, delegatee: agent.address, mint });
  const invBudget = await backend.allowanceStatus({ delegator: user.address, delegatee: merchant.address, mint });
  console.log(`  check budget       (user -> agent)     : ${fmtToken(checkBudget.remaining)}`);
  console.log(`  investigation budget (user -> Avoid.net): ${fmtToken(invBudget.remaining)}\n`);

  for (const entity of WATCHLIST) {
    const res = await fetch(`${base}/api/check?entity=${encodeURIComponent(entity)}`);

    if (res.status === 402) {
      // Known entity: pre-pay per cached check (agent is the delegatee).
      const quote = (await res.json()) as CheckQuote;
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
        console.log(`  ${entity}: check budget spent (${(err as Error).message})`);
        continue;
      }
      const served = await fetch(`${base}/api/check?entity=${encodeURIComponent(entity)}`, {
        headers: { "x-payment": reference },
      });
      const data = (await served.json()) as { report: ThreatReport; anchor?: AnchorInfo };
      logResult(entity, amount, "cache", data.report, data.anchor);
    } else if (res.status === 404) {
      // Unknown entity: commission an on-demand investigation (pay-on-completion).
      const inv = await fetch(`${base}/api/investigate?entity=${encodeURIComponent(entity)}`, {
        headers: { "x-budget": user.address },
      });
      if (inv.status === 402) {
        console.log(`  ${entity}: investigation budget spent`);
        continue;
      }
      if (!inv.ok) {
        console.log(`  ${entity}: investigation error ${inv.status}`);
        continue;
      }
      const data = (await inv.json()) as { charged: string; report: ThreatReport; anchor?: AnchorInfo };
      logResult(entity, BigInt(data.charged), "investigation", data.report, data.anchor);
    } else {
      console.log(`  ${entity}: unexpected status ${res.status}`);
    }
  }

  const checkAfter = await backend.allowanceStatus({ delegator: user.address, delegatee: agent.address, mint });
  const invAfter = await backend.allowanceStatus({ delegator: user.address, delegatee: merchant.address, mint });
  console.log(
    `\nRemaining -- checks: ${fmtToken(checkAfter.remaining)}, investigations: ${fmtToken(invAfter.remaining)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
