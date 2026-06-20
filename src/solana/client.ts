import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateKeyPairSync } from "node:crypto";
import {
  address,
  createClient,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { solanaLocalRpc } from "@solana/kit-plugin-rpc";
import { signer as signerPlugin } from "@solana/kit-plugin-signer";
import { tokenProgram } from "@solana-program/token";
import { subscriptionsProgram } from "@solana/subscriptions";
import { config } from "../config";

/** A loaded keypair: its address (base58) plus the kit signer used to sign txs. */
export interface Wallet {
  address: string;
  signer: KeyPairSigner;
}

/** Convert a base58 string to a kit Address. */
export function toAddress(s: string): Address {
  return address(s);
}

/**
 * Generate a fresh ed25519 keypair in Solana's 64-byte secret-key format
 * (32-byte seed || 32-byte public key), matching `solana-keygen` / id.json.
 * Done via Node crypto so setup needs no Solana CLI.
 */
export function generateKeypairBytes(): Uint8Array {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const seed = Buffer.from(jwk.d, "base64url"); // 32 bytes
  const pub = Buffer.from(jwk.x, "base64url"); // 32 bytes
  const out = new Uint8Array(64);
  out.set(seed, 0);
  out.set(pub, 32);
  return out;
}

export async function loadKeypairSigner(filePath: string): Promise<KeyPairSigner> {
  const resolved = path.resolve(
    filePath.startsWith("~") ? filePath.replace("~", os.homedir()) : filePath,
  );
  const bytes = Uint8Array.from(JSON.parse(await fs.readFile(resolved, "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

export async function loadWallet(filePath: string): Promise<Wallet> {
  const signer = await loadKeypairSigner(filePath);
  return { address: signer.address, signer };
}

/** Generate a keypair, persist it as a JSON byte array, and return the loaded wallet. */
export async function createAndSaveWallet(filePath: string): Promise<Wallet> {
  const bytes = generateKeypairBytes();
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(Array.from(bytes)));
  return loadWallet(filePath);
}

/** Generate an in-memory wallet (not persisted). Used for read-only RPC clients. */
export async function createEphemeralWallet(): Promise<Wallet> {
  const signer = await createKeyPairSignerFromBytes(generateKeypairBytes());
  return { address: signer.address, signer };
}

/**
 * Build the @solana/kit client wired with the signer, RPC, SPL token, and
 * subscriptions program plugins. `config.rpcUrl` may point at a local validator
 * or devnet.
 */
export function buildClient(wallet: Wallet) {
  return createClient()
    .use(signerPlugin(wallet.signer))
    .use(solanaLocalRpc({ rpcUrl: config.rpcUrl }))
    .use(tokenProgram())
    .use(subscriptionsProgram());
}

export type SubscriptionsClient = ReturnType<typeof buildClient>;
