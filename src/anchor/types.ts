/** Receipt that a verdict's content hash was anchored (on-chain or mock). */
export interface AnchorReceipt {
  /** The verdict content hash that was anchored. */
  hash: string;
  /** Tx signature (chain) or synthetic id (mock). */
  reference: string;
  /** Devnet/cluster explorer link to the anchoring tx (chain only). */
  explorerUrl?: string;
  anchoredAt: string;
}

/**
 * Anchors a verdict's content hash so the verdict is tamper-evident and
 * timestamped. Idempotent per hash (anchor once, reuse the receipt).
 */
export interface Anchor {
  readonly kind: "mock" | "chain";
  anchor(hash: string): Promise<AnchorReceipt>;
}
