import { describe, expect, it } from "vitest";
import { proofPayProductName } from "../src/index.js";

describe("shared package foundation", () => {
  it("exports the product identity for all workspaces", () => {
    expect(proofPayProductName).toBe("ProofPay AI");
  });
});
