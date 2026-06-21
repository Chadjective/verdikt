import { getAddMemoInstruction } from "@solana-program/memo";
import { config } from "../config";
import { buildClient, createEphemeralWallet, loadWallet, type Wallet } from "../solana/client";
import type { Anchor, AnchorReceipt } from "./types";

function extractSignature(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["signature", "txSignature", "transactionSignature"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    // kit sendTransaction returns { context: { signature } }
    const ctx = o.context as Record<string, unknown> | undefined;
    if (ctx && typeof ctx.signature === "string") return ctx.signature;
  }
  return String(r);
}

function explorerTx(sig: string): string {
  const url = config.rpcUrl;
  if (/devnet/.test(url)) return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  if (/127\.0\.0\.1|localhost/.test(url)) {
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(url)}`;
  }
  return `https://explorer.solana.com/tx/${sig}`;
}

/**
 * Anchors verdict hashes on-chain via the SPL Memo program. Signs with the
 * merchant (Avoid.net) wallet so anchors are attributable. Idempotent per hash.
 */
export class ChainAnchor implements Anchor {
  readonly kind = "chain" as const;
  private readonly seen = new Map<string, AnchorReceipt>();
  private signerWallet?: Wallet;

  private async wallet(): Promise<Wallet> {
    if (!this.signerWallet) {
      this.signerWallet = await loadWallet(config.keypairs.merchant).catch(() => createEphemeralWallet());
    }
    return this.signerWallet;
  }

  async anchor(hash: string): Promise<AnchorReceipt> {
    const existing = this.seen.get(hash);
    if (existing) return existing;
    const w = await this.wallet();
    const client = buildClient(w);
    const sent: unknown = await client.sendTransaction(
      getAddMemoInstruction({ memo: `avoid.net:verdict:${hash}`, signers: [w.signer] }),
    );
    const reference = extractSignature(sent);
    const receipt: AnchorReceipt = {
      hash,
      reference,
      explorerUrl: explorerTx(reference),
      anchoredAt: new Date().toISOString(),
    };
    this.seen.set(hash, receipt);
    return receipt;
  }
}
