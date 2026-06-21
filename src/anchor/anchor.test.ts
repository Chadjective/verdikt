import { describe, expect, it } from "vitest";
import { MockAnchor } from "./mock";

describe("MockAnchor", () => {
  it("anchors a hash and is idempotent per hash", async () => {
    const a = new MockAnchor();
    const r1 = await a.anchor("abc123def456");
    expect(r1.hash).toBe("abc123def456");
    expect(r1.reference).toContain("abc123def456");
    expect(a.kind).toBe("mock");

    // same hash -> same receipt (anchored once)
    const r2 = await a.anchor("abc123def456");
    expect(r2.reference).toBe(r1.reference);

    // different hash -> different receipt
    const r3 = await a.anchor("zzz999");
    expect(r3.reference).not.toBe(r1.reference);
  });
});
