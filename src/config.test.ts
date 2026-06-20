import { describe, it, expect } from "vitest";
import { fmtToken } from "./config";

describe("fmtToken", () => {
  it("formats whole and fractional amounts (6 decimals)", () => {
    expect(fmtToken(0n)).toBe("0");
    expect(fmtToken(1_000_000n)).toBe("1");
    expect(fmtToken(10_000n)).toBe("0.01");
    expect(fmtToken(100_000n)).toBe("0.1");
    expect(fmtToken(1_500_000n)).toBe("1.5");
    expect(fmtToken(1_234_560n)).toBe("1.23456");
  });

  it("trims trailing zeros", () => {
    expect(fmtToken(2_200_000n)).toBe("2.2");
    expect(fmtToken(5_000_000n)).toBe("5");
  });

  it("handles negative amounts", () => {
    expect(fmtToken(-10_000n)).toBe("-0.01");
    expect(fmtToken(-1_000_000n)).toBe("-1");
  });
});
