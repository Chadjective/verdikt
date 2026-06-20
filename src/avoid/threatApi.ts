/**
 * Avoid.net - threat-intelligence core (demo stub).
 *
 * In production this is a PAID HTTP API backed by the Avoid.net Gen-2 pipeline
 * (Scanner -> Analyst -> Verifier -> Reporter, with Critic + Orchestrator) and a
 * deterministic trust score S = f(severity, evidence, sources, critique), with
 * content hashes anchored on Solana. Here we ship a small, deterministic
 * stand-in so the payments demo returns meaningful verdicts with no network.
 *
 * This module is intentionally free of any Solana / payment code. It is the
 * "product" being metered -- the piece you lift into the real Avoid.net API
 * when porting this demo. All entities below are SYNTHETIC for illustration.
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
  /** Entity name or address that was checked. */
  query: string;
  /** Did Avoid.net have intel on this entity? */
  matched: boolean;
  verdict: Verdict;
  /** 0 (avoid) .. 100 (clear). */
  trustScore: number;
  severity: Severity;
  summary: string;
  reasons: string[];
  sources: ThreatSource[];
  checkedAt: string;
}

interface IntelRecord {
  /** Canonical display name. */
  name: string;
  /** Lookup keys (lower-cased): names and/or addresses. */
  keys: string[];
  trustScore: number;
  severity: Severity;
  summary: string;
  reasons: string[];
  sources: ThreatSource[];
}

/**
 * Synthetic intel set. Mirrors the shape of real Avoid.net investigations
 * without naming real entities.
 */
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

const INDEX: Map<string, IntelRecord> = (() => {
  const m = new Map<string, IntelRecord>();
  for (const rec of INTEL) {
    for (const key of rec.keys) m.set(key.toLowerCase(), rec);
  }
  return m;
})();

/** Map a deterministic trust score to an actionable verdict (Avoid.net thresholds). */
export function verdictFromScore(score: number): Verdict {
  if (score >= 75) return "clear";
  if (score >= 40) return "caution";
  return "avoid";
}

/**
 * Check an entity (name or address) against Avoid.net threat intelligence.
 * Pure and deterministic: identical input -> identical report.
 */
export function checkEntity(query: string): ThreatReport {
  const normalized = query.trim().toLowerCase();
  const checkedAt = new Date().toISOString();
  const rec = INDEX.get(normalized);

  if (!rec) {
    return {
      query,
      matched: false,
      verdict: "unknown",
      trustScore: 50,
      severity: "low",
      summary:
        "No intelligence on this entity yet. In production this triggers a live Avoid.net investigation; treat as unverified until a report exists.",
      reasons: ["Not present in the threat-intelligence index"],
      sources: [],
      checkedAt,
    };
  }

  return {
    query,
    matched: true,
    verdict: verdictFromScore(rec.trustScore),
    trustScore: rec.trustScore,
    severity: rec.severity,
    summary: rec.summary,
    reasons: rec.reasons,
    sources: rec.sources,
    checkedAt,
  };
}

/** Convenience: a short one-line decision an agent can log/act on. */
export function decisionLine(report: ThreatReport): string {
  const tag = report.verdict.toUpperCase();
  return `[${tag}] ${report.query} - trust ${report.trustScore}/100 (${report.severity}) - ${report.summary}`;
}
