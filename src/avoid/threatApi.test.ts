import { describe, it, expect } from "vitest";
import { checkEntity, decisionLine, investigate, lookup, verdictFromScore } from "./threatApi";

describe("verdictFromScore", () => {
  it("maps score bands to verdicts", () => {
    expect(verdictFromScore(100)).toBe("clear");
    expect(verdictFromScore(75)).toBe("clear");
    expect(verdictFromScore(74)).toBe("caution");
    expect(verdictFromScore(40)).toBe("caution");
    expect(verdictFromScore(39)).toBe("avoid");
    expect(verdictFromScore(0)).toBe("avoid");
  });
});

describe("lookup", () => {
  it("returns seeded known entities", () => {
    const r = lookup("DrainCoin");
    expect(r).not.toBeNull();
    expect(r?.verdict).toBe("avoid");
    expect(r?.trustScore).toBe(4);
  });

  it("is case-insensitive", () => {
    expect(lookup("acme exchange")?.verdict).toBe("clear");
  });

  it("returns null for an unknown entity", () => {
    expect(lookup("totally-unknown-token-xyz")).toBeNull();
  });
});

describe("investigate", () => {
  it("produces a fresh, in-range, self-consistent report", async () => {
    const r = await investigate("UnitTestToken-ABC", 0);
    expect(r.fresh).toBe(true);
    expect(r.priority).toBe(true);
    expect(r.matched).toBe(true);
    expect(r.trustScore).toBeGreaterThanOrEqual(0);
    expect(r.trustScore).toBeLessThanOrEqual(100);
    expect(r.verdict).toBe(verdictFromScore(r.trustScore));
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("caches the result so the next lookup is a hit", async () => {
    const name = "UnitTestToken-Cache";
    expect(lookup(name)).toBeNull();
    const fresh = await investigate(name, 0);
    expect(lookup(name)?.trustScore).toBe(fresh.trustScore);
  });

  it("is deterministic for the same query", async () => {
    const a = await investigate("UnitTestToken-Det", 0);
    const b = await investigate("UnitTestToken-Det", 0);
    expect(b.trustScore).toBe(a.trustScore);
    expect(b.verdict).toBe(a.verdict);
  });
});

describe("checkEntity", () => {
  it("returns a cached report for a known entity", () => {
    expect(checkEntity("GhostBridge").matched).toBe(true);
  });

  it("returns an unknown placeholder for an uncached entity", () => {
    const r = checkEntity("no-such-entity-123");
    expect(r.matched).toBe(false);
    expect(r.verdict).toBe("unknown");
  });
});

describe("decisionLine", () => {
  it("includes the verdict tag", () => {
    expect(decisionLine(lookup("DrainCoin")!)).toContain("[AVOID]");
  });

  it("marks freshly investigated reports", async () => {
    const fresh = await investigate("UnitTestToken-Line", 0);
    expect(decisionLine(fresh)).toContain("(fresh)");
  });
});
