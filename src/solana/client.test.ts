import { afterAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createAndSaveWallet, generateKeypairBytes, loadWallet } from "./client";

const files: string[] = [];
afterAll(async () => {
  for (const f of files) {
    try {
      await fs.rm(f);
    } catch {
      /* ignore */
    }
  }
});

describe("generateKeypairBytes", () => {
  it("returns a 64-byte secret key", () => {
    expect(generateKeypairBytes().length).toBe(64);
  });

  it("returns distinct keypairs", () => {
    const a = Buffer.from(generateKeypairBytes()).toString("hex");
    const b = Buffer.from(generateKeypairBytes()).toString("hex");
    expect(a).not.toBe(b);
  });
});

describe("wallet save/load roundtrip", () => {
  it("creates a loadable wallet with a stable base58 address", async () => {
    const p = path.join(os.tmpdir(), `verdikt-kp-${process.hrtime.bigint()}.json`);
    files.push(p);
    const created = await createAndSaveWallet(p);
    expect(created.address.length).toBeGreaterThanOrEqual(32);
    const loaded = await loadWallet(p);
    expect(loaded.address).toBe(created.address);
  });
});
