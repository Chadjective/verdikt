import type { Anchor, AnchorReceipt } from "./types";

/** In-memory anchor: mirrors the on-chain anchoring semantics with no chain. */
export class MockAnchor implements Anchor {
  readonly kind = "mock" as const;
  private readonly seen = new Map<string, AnchorReceipt>();

  async anchor(hash: string): Promise<AnchorReceipt> {
    const existing = this.seen.get(hash);
    if (existing) return existing;
    const receipt: AnchorReceipt = {
      hash,
      reference: `mock-anchor-${hash.slice(0, 16)}`,
      anchoredAt: new Date().toISOString(),
    };
    this.seen.set(hash, receipt);
    return receipt;
  }
}
