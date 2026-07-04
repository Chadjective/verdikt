import { describe, expect, it } from "vitest";
import {
  generateKeyPairSigner,
  getBase58Decoder,
  getUtf8Encoder,
  signBytes,
} from "@solana/kit";
import {
  BUDGET_AUTH_MAX_SKEW_S,
  canonicalBudgetMessage,
  verifyBudgetOwnership,
} from "./auth";

const NOW = 1_700_000_000;

describe("verifyBudgetOwnership", () => {
  it("accepts a fresh signature by the budget owner", async () => {
    const s = await generateKeyPairSigner();
    const ts = String(NOW);
    const msg = getUtf8Encoder().encode(canonicalBudgetMessage("acme", s.address, ts));
    const sig = getBase58Decoder().decode(await signBytes(s.keyPair.privateKey, msg));
    const r = await verifyBudgetOwnership({
      budgetOwner: s.address,
      entity: "acme",
      ts,
      signature: sig,
      nowUnix: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing signature or timestamp", async () => {
    const s = await generateKeyPairSigner();
    expect(
      (await verifyBudgetOwnership({ budgetOwner: s.address, entity: "acme", ts: String(NOW), signature: undefined, nowUnix: NOW })).error,
    ).toBe("missing_signature");
    expect(
      (await verifyBudgetOwnership({ budgetOwner: s.address, entity: "acme", ts: undefined, signature: "x", nowUnix: NOW })).error,
    ).toBe("missing_signature");
  });

  it("rejects a stale timestamp outside the skew window", async () => {
    const s = await generateKeyPairSigner();
    const ts = String(NOW - BUDGET_AUTH_MAX_SKEW_S - 5);
    const msg = getUtf8Encoder().encode(canonicalBudgetMessage("acme", s.address, ts));
    const sig = getBase58Decoder().decode(await signBytes(s.keyPair.privateKey, msg));
    const r = await verifyBudgetOwnership({ budgetOwner: s.address, entity: "acme", ts, signature: sig, nowUnix: NOW });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("stale_timestamp");
  });

  it("rejects a signature that does not match the budget owner (the drain attack)", async () => {
    // Attacker knows the victim's address but signs with their own key.
    const victim = await generateKeyPairSigner();
    const ts = String(NOW);
    const attackerMsg = getUtf8Encoder().encode(canonicalBudgetMessage("acme", victim.address, ts));
    const attacker = await generateKeyPairSigner();
    const attackerSig = getBase58Decoder().decode(await signBytes(attacker.keyPair.privateKey, attackerMsg));
    const r = await verifyBudgetOwnership({ budgetOwner: victim.address, entity: "acme", ts, signature: attackerSig, nowUnix: NOW });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad_signature");
  });

  it("rejects a signature bound to a different entity (no cross-entity replay)", async () => {
    const s = await generateKeyPairSigner();
    const ts = String(NOW);
    const msg = getUtf8Encoder().encode(canonicalBudgetMessage("other-entity", s.address, ts));
    const sig = getBase58Decoder().decode(await signBytes(s.keyPair.privateKey, msg));
    const r = await verifyBudgetOwnership({ budgetOwner: s.address, entity: "acme", ts, signature: sig, nowUnix: NOW });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad_signature");
  });

  it("rejects malformed base58 / wrong-length signatures without throwing", async () => {
    const s = await generateKeyPairSigner();
    const r = await verifyBudgetOwnership({ budgetOwner: s.address, entity: "acme", ts: String(NOW), signature: "not-a-real-signature", nowUnix: NOW });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad_signature");
  });
});
