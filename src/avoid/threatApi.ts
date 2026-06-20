/**
 * Avoid.net - threat-intelligence core (demo stub).
 *
 * In production this is a PAID HTTP API backed by the Avoid.net Gen-2 pipeline
 * (Scanner -> Analyst -> Verifier -> Reporter, with Critic + Orchestrator) and a
 * deterministic trust score S = f(severity, evidence, sources, critique), with
 * content hashes anchored on Solana.
 *
 * Two operations, two price tiers:
 *   - lookup()     : cheap, instant cache hit for already-investigated entities.
 *   - investigate(): premium, on-demand fresh investigation (simulated compute)
 *                    for unknowns. In production this enqueues a high-priority
 *                    `investigation_request` for the `avoid-investigator` agent.
 *
 * This module is free of any Solana / payment code -- it is the "product" being
 * metered, and the piece you lift into the real Avoid.net API. All entities are
 * SYNTHETIC for illustration.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "none";
export type Verdict = "avoid" | "caution" | "clear" | "unknown";

export interface ThreatSource {
  /** Avoid.net data source, e.g. "ZachXBT", "SEAL", "Forta", "ScamSniffer". */
  name: string;
  url?: string;
  note: string;
}

export interface ThreatReport {
  query: string;
  matched: boolean;
  verdict: Verdict;
  trustScore: number; // 0 (avoid) .. 100 (clear)
  severity: Severity;
  summary: string;
  reasons: string[];
  sources: ThreatSource[];
  checkedAt: string;
  /** True when produced by an on-demand investigation (not a cache hit). */
  fresh?: boolean;
  /** Compute time spent on the investigation (ms). */
  investigationMs?: number;
  /** True when the investigation jumped the queue (paid priority). */
  priority?: boolean;
}

interface IntelRecord {
  name: string;
  keys: string[];
  trustScore: number;
  severity: Severity;
  summary: string;
  reasons: string[];
  sources: ThreatSource[];
}

/** Seed intel set (synthetic). Mirrors real Avoid.net investigations. */
const INTEL: IntelRecord[] = [
  {
    name: "DrainCoin (DRAIN)",
    keys: ["draincoin", "drain", "so1draindemo1111111111111111111111111111111"],
    trustScore: 4,
    severity: "critical",
    summary:
      "Active wallet-drainer token. Approving or swapping grants a malicious delegate that sweeps the wallet.",
    reasons: [
      "Drainer signature match in transaction history",
      "Listed on ScamSniffer malicious-address blocklist",
      "ZachXBT thread links deployer to prior drainer campaigns",
      "GoPlus flags hidden owner mint + unlimited approval",
    ],
    sources: [
      { name: "ZachXBT", note: "Telegram thread attributing deployer to a known drainer crew" },
      { name: "ScamSniffer", note: "Address on malicious-contract blocklist" },
      { name: "GoPlus", note: "Token security scan: hidden mint authority, unlimited approval" },
    ],
  },
  {
    name: "GhostBridge",
    keys: ["ghostbridge", "ghost bridge", "so1ghostbridgedemo22222222222222222222222222"],
    trustScore: 23,
    severity: "high",
    summary:
      "Unaudited cross-chain bridge showing honeypot and rug indicators. Liquidity can be pulled by a single EOA.",
    reasons: [
      "Unverified contract; upgrade authority is a single externally-owned account",
      "RugCheck: LP not locked, mint authority retained",
      "Forta alert: anomalous large outbound transfer pattern",
    ],
    sources: [
      { name: "RugCheck", note: "LP unlocked, mint authority retained (Solana-native scan)" },
      { name: "Forta", note: "Real-time alert: anomalous outflow pattern" },
      { name: "DefiLlama Hacks", note: "No confirmed exploit yet; flagged as elevated risk" },
    ],
  },
  {
    name: "Acme Exchange",
    keys: ["acme exchange", "acme", "so1acmeexchangedemo3333333333333333333333333"],
    trustScore: 88,
    severity: "none",
    summary:
      "Established exchange. No active threats. Independent audit on file, addresses clean against sanctions lists.",
    reasons: [
      "No incidents across monitored sources in the trailing 12 months",
      "Audit report on file; proof-of-reserves published",
      "Treasury addresses clean against OFAC SDN list",
    ],
    sources: [
      { name: "SEAL", note: "No active incident reports" },
      { name: "OFAC SDN", note: "No address matches on the sanctions list" },
      { name: "GoPlus", note: "Token security scan clean" },
    ],
  },
];

function recordToReport(rec: IntelRecord, query: string): ThreatReport {
  return {
    query,
    matched: true,
    verdict: verdictFromScore(rec.trustScore),
    trustScore: rec.trustScore,
    severity: rec.severity,
    summary: rec.summary,
    reasons: rec.reasons,
    sources: rec.sources,
    checkedAt: new Date().toISOString(),
  };
}

/** Cache of investigated entities (seeded from INTEL, grows with investigate()). */
const cache = new Map<string, ThreatReport>();
for (const rec of INTEL) {
  for (const key of rec.keys) cache.set(key.toLowerCase(), recordToReport(rec, rec.name));
}

/** Map a deterministic trust score to an actionable verdict (Avoid.net thresholds). */
export function verdictFromScore(score: number): Verdict {
  if (score >= 75) return "clear";
  if (score >= 40) return "caution";
  return "avoid";
}

/** Cache hit for an already-investigated entity, or null if unknown. */
export function lookup(query: string): ThreatReport | null {
  return cache.get(query.trim().toLowerCase()) ?? null;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function severityFromScore(score: number): Severity {
  if (score >= 75) return "none";
  if (score >= 50) return "low";
  if (score >= 40) return "medium";
  if (score >= 20) return "high";
  return "critical";
}

function synthDetails(verdict: Verdict): { summary: string; reasons: string[]; sources: ThreatSource[] } {
  if (verdict === "avoid") {
    return {
      summary: "Fresh investigation surfaced strong scam indicators. Do not interact.",
      reasons: [
        "Mint/upgrade authority retained by a single unverified account",
        "RugCheck: liquidity not locked",
        "Forta: anomalous approval + outflow pattern in early activity",
      ],
      sources: [
        { name: "RugCheck", note: "LP unlocked, authority retained" },
        { name: "Forta", note: "Anomalous early-activity alert" },
        { name: "GoPlus", note: "Token security scan: elevated risk flags" },
      ],
    };
  }
  if (verdict === "caution") {
    return {
      summary: "Fresh investigation found mixed signals. Proceed only with limits.",
      reasons: [
        "Contract verified but young; limited track record",
        "Liquidity adequate but concentration is high",
        "No incident reports yet, but monitoring is sparse",
      ],
      sources: [
        { name: "RugCheck", note: "Moderate risk: holder concentration" },
        { name: "GoPlus", note: "No critical flags; thin history" },
      ],
    };
  }
  return {
    summary: "Fresh investigation found no active threats at this time.",
    reasons: [
      "Verified contract; no incidents across monitored sources",
      "Liquidity locked; authorities renounced or multisig-held",
      "Addresses clean against OFAC SDN list",
    ],
    sources: [
      { name: "SEAL", note: "No active incident reports" },
      { name: "OFAC SDN", note: "No sanctions-list match" },
      { name: "GoPlus", note: "Token security scan clean" },
    ],
  };
}

/**
 * Run an on-demand investigation for an unknown entity. Simulates the compute
 * cost of a pipeline run, synthesizes a deterministic verdict, caches it (so
 * the next lookup is the cheap tier), and returns it marked `fresh`.
 */
export async function investigate(query: string, computeMs = 800): Promise<ThreatReport> {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, computeMs)));
  const key = query.trim().toLowerCase();
  const score = fnv1a(key) % 101;
  const verdict = verdictFromScore(score);
  const { summary, reasons, sources } = synthDetails(verdict);
  const report: ThreatReport = {
    query,
    matched: true,
    verdict,
    trustScore: score,
    severity: severityFromScore(score),
    summary,
    reasons,
    sources,
    checkedAt: new Date().toISOString(),
    fresh: true,
    investigationMs: computeMs,
    priority: true,
  };
  cache.set(key, report);
  return report;
}

/**
 * Cache lookup with an "unknown" placeholder fallback (no investigation).
 * Used by routes that only serve already-known intel.
 */
export function checkEntity(query: string): ThreatReport {
  const hit = lookup(query);
  if (hit) return hit;
  return {
    query,
    matched: false,
    verdict: "unknown",
    trustScore: 50,
    severity: "low",
    summary:
      "No intelligence on this entity yet. Commission an on-demand investigation to get a verdict.",
    reasons: ["Not present in the threat-intelligence cache"],
    sources: [],
    checkedAt: new Date().toISOString(),
  };
}

/** Short one-line decision an agent can log/act on. */
export function decisionLine(report: ThreatReport): string {
  const tag = report.verdict.toUpperCase();
  const fresh = report.fresh ? " (fresh)" : "";
  return `[${tag}]${fresh} ${report.query} - trust ${report.trustScore}/100 (${report.severity}) - ${report.summary}`;
}
