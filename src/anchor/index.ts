import { config } from "../config";
import type { Anchor } from "./types";
import { MockAnchor } from "./mock";
import { ChainAnchor } from "./chain";

let cached: Anchor | undefined;

/** Returns the configured anchor backend (one shared instance per process). */
export function createAnchor(): Anchor {
  if (!cached) {
    cached = config.payments === "chain" ? new ChainAnchor() : new MockAnchor();
  }
  return cached;
}

export type { Anchor, AnchorReceipt } from "./types";
