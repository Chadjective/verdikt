import "dotenv/config";

export type PaymentsMode = "mock" | "chain";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  /** RPC endpoint (local validator / Surfpool, or devnet). Used only in chain mode. */
  rpcUrl: env("RPC_URL", "http://127.0.0.1:8899"),
  /** Payment backend: "mock" (no chain) or "chain" (real subscriptions program). */
  payments: env("PAYMENTS", "mock") as PaymentsMode,
  /** SPL token mint (6 decimals) used for payments. */
  tokenMint: env("TOKEN_MINT", ""),
  port: Number(env("PORT", "4021")),
  /** Price per cached threat-check (cheap tier), in token base units. */
  pricePerCheck: BigInt(env("PRICE_PER_CHECK", "10000")),
  /** Price per on-demand investigation (premium tier: covers compute), base units. */
  pricePerInvestigation: BigInt(env("PRICE_PER_INVESTIGATION", "100000")),
  /** Simulated investigation compute time (ms). */
  investigationMs: Number(env("INVESTIGATION_MS", "800")),
  keypairs: {
    user: env("USER_KEYPAIR", ".keys/user.json"),
    agent: env("AGENT_KEYPAIR", ".keys/agent.json"),
    merchant: env("MERCHANT_KEYPAIR", ".keys/merchant.json"),
  },
};

export function serverBaseUrl(): string {
  return `http://127.0.0.1:${config.port}`;
}

export const TOKEN_DECIMALS = 6;

/** Placeholder mint used in mock mode (no real SPL mint needed). */
export const MOCK_MINT = "MockM1nt1111111111111111111111111111111111";

/** The mint payments are denominated in: the real SPL mint (chain) or a mock id. */
export function activeMint(): string {
  if (config.payments === "chain") {
    if (!config.tokenMint) {
      throw new Error("PAYMENTS=chain requires TOKEN_MINT in .env (see `npm run setup`).");
    }
    return config.tokenMint;
  }
  return MOCK_MINT;
}

/** Format token base units (6 decimals) for display, trimming trailing zeros. */
export function fmtToken(base: bigint): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
