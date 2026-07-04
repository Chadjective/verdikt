import {
  address,
  getAddressEncoder,
  getBase58Encoder,
  getUtf8Encoder,
  verifySignature,
  type SignatureBytes,
} from "@solana/kit";

/**
 * Proof-of-ownership for the /api/investigate x-budget flow.
 *
 * The investigation route pulls from the budget owner's on-chain allowance
 * (Avoid.net is the delegatee). A bare `x-budget: <address>` header is NOT
 * authorization — anyone can name a victim's public address and drain their
 * allowance. So the caller must prove control of that key by signing a
 * canonical, request-bound, time-limited message with it. We verify the
 * Ed25519 signature against the address before any allowance is touched.
 *
 * Required headers on GET /api/investigate:
 *   x-budget      : allowance owner address (base58)
 *   x-budget-ts   : unix seconds (string); rejected if outside the skew window
 *   x-budget-sig  : base58 Ed25519 signature over canonicalBudgetMessage(...)
 */

/** Max age (seconds) of a signed request before it is rejected as stale. */
export const BUDGET_AUTH_MAX_SKEW_S = 120;

/** The exact bytes the client must sign. Binds the spend to (entity, owner, ts). */
export function canonicalBudgetMessage(
  entity: string,
  budgetOwner: string,
  ts: string,
): string {
  return `verdikt:investigate:${entity}:${budgetOwner}:${ts}`;
}

export interface BudgetAuthInput {
  budgetOwner: string;
  entity: string;
  ts: string | undefined;
  signature: string | undefined;
  /** Injected for testability; defaults to the real clock. */
  nowUnix?: number;
}

export interface BudgetAuthResult {
  ok: boolean;
  /** Machine-readable reason on failure (safe to return to the caller). */
  error?: "missing_signature" | "stale_timestamp" | "bad_signature";
}

/**
 * Verify that `signature` is a valid Ed25519 signature by `budgetOwner` over the
 * canonical message for (entity, ts), and that `ts` is within the skew window.
 * Never throws — malformed input resolves to { ok: false }.
 */
export async function verifyBudgetOwnership(
  input: BudgetAuthInput,
): Promise<BudgetAuthResult> {
  const { budgetOwner, entity, ts, signature } = input;
  if (!ts || !signature) return { ok: false, error: "missing_signature" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, error: "stale_timestamp" };
  const now = input.nowUnix ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > BUDGET_AUTH_MAX_SKEW_S) {
    return { ok: false, error: "stale_timestamp" };
  }

  try {
    const pubkey = new Uint8Array(getAddressEncoder().encode(address(budgetOwner)));
    const key = await crypto.subtle.importKey(
      "raw",
      pubkey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const sigBytes = new Uint8Array(
      getBase58Encoder().encode(signature),
    ) as unknown as SignatureBytes;
    // A valid Ed25519 signature is exactly 64 bytes; reject anything else early.
    if (sigBytes.length !== 64) return { ok: false, error: "bad_signature" };
    const message = getUtf8Encoder().encode(
      canonicalBudgetMessage(entity, budgetOwner, ts),
    );
    const ok = await verifySignature(key, sigBytes, message);
    return ok ? { ok: true } : { ok: false, error: "bad_signature" };
  } catch {
    return { ok: false, error: "bad_signature" };
  }
}
