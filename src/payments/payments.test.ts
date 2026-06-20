import { describe, it, expect } from "vitest";
import { createPaymentBackend } from "./index";
import { extractSignature } from "./chain";

describe("payment backend factory", () => {
  it("returns the mock backend by default", () => {
    expect(createPaymentBackend().kind).toBe("mock");
  });

  it("returns a shared singleton instance", () => {
    expect(createPaymentBackend()).toBe(createPaymentBackend());
  });
});

describe("extractSignature", () => {
  it("passes through a string signature", () => {
    expect(extractSignature("sig_abc")).toBe("sig_abc");
  });

  it("reads a signature field from an object result", () => {
    expect(extractSignature({ signature: "abc" })).toBe("abc");
    expect(extractSignature({ transactionSignature: "xyz" })).toBe("xyz");
  });
});
