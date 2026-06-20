import { config } from "../config";
import type { PaymentBackend } from "./types";
import { MockPayments } from "./mock";
import { ChainPayments } from "./chain";

let cached: PaymentBackend | undefined;

/** Returns the configured payment backend (one shared instance per process). */
export function createPaymentBackend(): PaymentBackend {
  if (!cached) {
    cached = config.payments === "chain" ? new ChainPayments() : new MockPayments();
  }
  return cached;
}

export type { PaymentBackend } from "./types";
