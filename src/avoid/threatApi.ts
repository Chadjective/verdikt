/**
 * Avoid.net - threat-intelligence core (demo stub).
 *
 * Every verdict carries (1) a deterministic `contentHash` over the assessment,
 * so it can be anchored on-chain and later verified, and (2) a verdict-aware
 * freshness window (`ttlSeconds`/`expiresAt`/`freshness`) computed at read time
 * -- because a "clear" verdict decays fast (clean now != clean later) while a
 * confirmed scam stays bad for a long time.
 *
 * This module is free of Solana / payment code -- it's the "product" being
 * metered. On-chain anchoring of the hash is done by the Anchor backend, in the
 * server. All entities below are SYNTHETIC for illustration.
 */

import { createHash } from "node:crypto";

export type Severity = "critical" | "high" | "medium" | "low" | "none";
export type Verdict = "avoid" | "caution" | "clear" | "unknown";
export type Freshness = "fresh" | "aging" | "stale";

export interface ThreatSource {
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
  /** When the assessment was produced (ISO). */
  checkedAt: string;
  /** Validity window for this verdict, in seconds (verdict-dependent). */
  ttlSeconds: number;
  /** ISO time after which the verdict should be treated as stale. */
  expiresAt: string;
  /** Freshness at READ time: fresh | aging | stale. */
  freshness: Freshness;
  /** Deterministic hash of the assessment content (for on-chain anchoring). */
  contentHash: string;
  /** True when produced by an on-demand investigation (not a cache hit). */
  fresh?: boolean;
  investigationMs?: number;
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

/** Seed intel set (synthetic). */
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

/** Map a deterministic trust score to an actionable verdict (Avoid.net thresholds). */
export function verdictFromScore(score: number): Verdict {
  if (score >= 75) return "clear";
  if (score >= 40) return "caution";
  return "avoid";
}

/**
 * Verdict validity windows. A confirmed scam stays a scam for a long time; a
 * "clear" verdict decays fast because clean-now does not mean clean-later.
 */
export function ttlForVerdict(verdict: Verdict): number {
  switch (verdict) {
    case "avoid":
      return 30 * 24 * 3600; // 30 days
    case "caution":
      return 12 * 3600; // 12 hours
    case "clear":
      return 6 * 3600; // 6 hours
    default:
      return 3600; // unknown: 1 hour
  }
}

interface HashFields {
  entity: string;
  verdict: Verdict;
  trustScore: number;
  severity: Severity;
  summary: string;
  reasons: string[];
  sources: ThreatSource[];
}

/** Deterministic sha256 over the assessment content (stable key order). */
export function contentHashOf(f: HashFields): string {
  const canonical = JSON.stringify({
    entity: f.entity.trim().toLowerCase(),
    verdict: f.verdict,
    trustScore: f.trustScore,
    severity: f.severity,
    summary: f.summary,
    reasons: f.reasons,
    sources: f.sources,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function freshnessFor(checkedAtMs: number, ttlSeconds: number, nowMs: number): Freshness {
  const ageSeconds = (nowMs - checkedAtMs) / 1000;
  if (ageSeconds >= ttlSeconds) return "stale";
  if (ageSeconds >= ttlSeconds * 0.5) return "aging";
  return "fresh";
}

/** The cached assessment, minus the read-time freshness/expiry fields. */
type VerdictBase = Omit<ThreatReport, "freshness" | "expiresAt">;

const cache = new Map<string, VerdictBase>();

function baseFromRecord(rec: IntelRecord, query: string, checkedAt: string): VerdictBase {
  const verdict = verdictFromScore(rec.trustScore);
  return {
    query,
    matched: true,
    verdict,
    trustScore: rec.trustScore,
    severity: rec.severity,
    summary: rec.summary,
    reasons: rec.reasons,
    sources: rec.sources,
    checkedAt,
    ttlSeconds: ttlForVerdict(verdict),
    contentHash: contentHashOf({
      entity: query,
      verdict,
      trustScore: rec.trustScore,
      severity: rec.severity,
      summary: rec.summary,
      reasons: rec.reasons,
      sources: rec.sources,
    }),
  };
}

const SEED_TIME = new Date().toISOString();
for (const rec of INTEL) {
  for (const key of rec.keys) cache.set(key.toLowerCase(), baseFromRecord(rec, rec.name, SEED_TIME));
}

/** Attach read-time freshness + expiry to a cached base assessment. */
function finalize(base: VerdictBase, nowMs: number = Date.now()): ThreatReport {
  const checkedAtMs = Date.parse(base.checkedAt);
  return {
    ...base,
    expiresAt: new Date(checkedAtMs + base.ttlSeconds * 1000).toISOString(),
    freshness: freshnessFor(checkedAtMs, base.ttlSeconds, nowMs),
  };
}

/** Cache hit for an already-investigated entity (freshness computed now), or null. */
export function lookup(query: string): ThreatReport | null {
  const base = cache.get(query.trim().toLowerCase());
  return base ? finalize(base) : null;
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Run an on-demand investigation for an unknown entity. Simulates compute,
 * synthesizes a deterministic verdict, stamps it with a verdict-aware TTL +
 * content hash, caches it, and returns it marked `fresh`.
 */
export async function investigate(query: string, computeMs = 800): Promise<ThreatReport> {
  await sleep(computeMs);
  const key = query.trim().toLowerCase();
  const score = fnv1a(key) % 101;
  const verdict = verdictFromScore(score);
  const severity = severityFromScore(score);
  const { summary, reasons, sources } = synthDetails(verdict);
  const base: VerdictBase = {
    query,
    matched: true,
    verdict,
    trustScore: score,
    severity,
    summary,
    reasons,
    sources,
    checkedAt: new Date().toISOString(),
    ttlSeconds: ttlForVerdict(verdict),
    contentHash: contentHashOf({ entity: query, verdict, trustScore: score, severity, summary, reasons, sources }),
    fresh: true,
    investigationMs: computeMs,
    priority: true,
  };
  cache.set(key, base);
  return finalize(base);
}

/** Cache lookup with an "unknown" placeholder fallback (no investigation). */
export function checkEntity(query: string): ThreatReport {
  const hit = lookup(query);
  if (hit) return hit;
  const verdict: Verdict = "unknown";
  const summary =
    "No intelligence on this entity yet. Commission an on-demand investigation to get a verdict.";
  const reasons = ["Not present in the threat-intelligence cache"];
  const sources: ThreatSource[] = [];
  const base: VerdictBase = {
    query,
    matched: false,
    verdict,
    trustScore: 50,
    severity: "low",
    summary,
    reasons,
    sources,
    checkedAt: new Date().toISOString(),
    ttlSeconds: ttlForVerdict(verdict),
    contentHash: contentHashOf({ entity: query, verdict, trustScore: 50, severity: "low", summary, reasons, sources }),
  };
  return finalize(base);
}

/** Short one-line decision an agent can log/act on. */
export function decisionLine(report: ThreatReport): string {
  const tag = report.verdict.toUpperCase();
  const fresh = report.fresh ? " (fresh)" : "";
  const stale = report.freshness === "stale" ? " [STALE]" : "";
  return `[${tag}]${fresh}${stale} ${report.query} - trust ${report.trustScore}/100 (${report.severity}) - ${report.summary}`;
}
