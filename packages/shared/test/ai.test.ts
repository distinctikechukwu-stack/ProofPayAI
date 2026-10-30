import { describe, expect, it } from "vitest";
import { allocateBudgetByWeight, changeOrderDraftSchema, generatedMilestonesSchema } from "../src/index.js";

describe("AI output safeguards", () => {
  it("allocates exact minor units deterministically from relative weights", () => {
    expect(allocateBudgetByWeight(60_000, [1, 1, 2])).toEqual([15_000, 15_000, 30_000]);
    expect(allocateBudgetByWeight(5, [1, 1, 1])).toEqual([2, 2, 1]);
    expect(allocateBudgetByWeight(60_000, [3, 9]).reduce((sum, amount) => sum + BigInt(amount), 0n)).toBe(60_000n);
  });

  it("rejects impossible or malformed model milestone output", () => {
    expect(() => allocateBudgetByWeight(2, [1, 1, 1])).toThrow(RangeError);
    expect(() => allocateBudgetByWeight(600, [0, 1])).toThrow(RangeError);
    expect(generatedMilestonesSchema.safeParse({
      rationale: "A valid explanation.",
      milestones: [{ sequence: 1, title: "Build", description: "Build the site", deliverables: ["Pages"], acceptanceCriteria: ["Matches brief"], completionConditions: ["Client accepts"], allocationWeight: 1, suggestedDueInDays: null, dependencySequences: [1] }],
    }).success).toBe(false);
  });

  it("requires a real amendment change and a valid idempotent draft", () => {
    const proposal = {
      idempotencyKey: "d9e1470e-7485-493f-b8a7-a251e66e82e9",
      title: "Add booking calendar",
      description: "Add a client-facing booking calendar.",
      amountDeltaMinor: 25_000,
      scheduleDeltaDays: 7,
      deliverables: ["Booking calendar"],
      openQuestions: ["Which calendar provider should be used?"],
      analysisId: "6de201bd-171c-4a35-9876-6302163f034a",
    };
    expect(changeOrderDraftSchema.safeParse(proposal).success).toBe(true);
    expect(changeOrderDraftSchema.safeParse({ ...proposal, amountDeltaMinor: 0, scheduleDeltaDays: 0, deliverables: [] }).success).toBe(false);
  });
});
