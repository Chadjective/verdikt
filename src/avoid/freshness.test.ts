import { describe, expect, it } from "vitest";
import { contentHashOf, investigate, lookup, ttlForVerdict } from "./threatApi";

describe("ttlForVerdict", () => {
  it("confirmed scams live long; 'clear' decays fast; unknown is shortest", () => {
    expect(ttlForVerdict("avoid")).toBeGreaterThan(ttlForVerdict("caution"));
    expect(ttlForVerdict("caution")).toBeGreaterThan(ttlForVerdict("clear"));
    expect(ttlForVerdict("clear")).toBeGreaterThan(ttlForVerdict("unknown"));
  });
});

describe("contentHashOf", () => {
  const base = {
    entity: "x",
    verdict: "avoid" as const,
    trustScore: 4,
    severity: "critical" as const,
    summary: "s",
    reasons: ["r"],
    sources: [],
  };

  it("is deterministic and a 64-char sha256 hex", () => {
    const h1 = contentHashOf(base);
    expect(h1).toBe(contentHashOf(base));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the assessment changes", () => {
    expect(contentHashOf({ ...base, trustScore: 5 })).not.toBe(contentHashOf(base));
  });
});

describe("freshness + hash on reports", () => {
  it("a freshly investigated verdict is fresh and carries a hash + future expiry", async () => {
    const r = await investigate("FreshnessToken-1", 0);
    expect(r.freshness).toBe("fresh");
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(r.expiresAt)).toBeGreaterThan(Date.parse(r.checkedAt));
  });

  it("a known seed verdict has a stable content hash across lookups", () => {
    expect(lookup("DrainCoin")?.contentHash).toBe(lookup("DrainCoin")?.contentHash);
    expect(lookup("DrainCoin")?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
