import { describe, expect, it } from "vitest";
import {
  createProjectDraftSchema,
  draftMilestonePlanSchema,
  submitDeliverableSchema,
  sumMoneyMinor,
} from "../src/index.js";

const validDraft = {
  idempotencyKey: "d75499e7-64e7-4e8a-b902-e3c8ff6ea217",
  title: "A small website",
  description: "Design and build a marketing site.",
  clientName: "Northstar Studio",
  budgetMinor: 60_000,
  currency: "USD",
  requirements: ["Responsive pages", "Accessible navigation"],
  milestones: [
    { sequence: 1, title: "Design", description: "Approve design", deliverables: ["Figma link"], acceptanceCriteria: ["Client sign-off"], completionConditions: ["Client approved the design"], amountMinor: 15_000 },
    { sequence: 2, title: "Build", description: "Implement the site", deliverables: ["Web pages"], acceptanceCriteria: ["Pages render on mobile"], completionConditions: ["Client accepted the build"], amountMinor: 45_000, dependencySequences: [1] },
  ],
};

describe("project boundary validation", () => {
  it("accepts exact minor-unit milestone totals and earlier dependencies", () => {
    expect(createProjectDraftSchema.safeParse(validDraft).success).toBe(true);
    expect(sumMoneyMinor([15_000, 45_000])).toBe(60_000n);
  });

  it("rejects mismatched totals, duplicate sequences, and future dependencies", () => {
    expect(createProjectDraftSchema.safeParse({ ...validDraft, budgetMinor: 60_001 }).success).toBe(false);
    const invalidSequence = { ...validDraft, milestones: [validDraft.milestones[0], { ...validDraft.milestones[1], sequence: 1 }] };
    expect(createProjectDraftSchema.safeParse(invalidSequence).success).toBe(false);
    const futureDependency = { ...validDraft, milestones: [validDraft.milestones[0], { ...validDraft.milestones[1], dependencySequences: [2] }] };
    expect(createProjectDraftSchema.safeParse(futureDependency).success).toBe(false);
  });

  it("validates editable draft milestone plans with contiguous sequence and exact money fields", () => {
    expect(draftMilestonePlanSchema.safeParse({ milestones: validDraft.milestones }).success).toBe(true);
    expect(draftMilestonePlanSchema.safeParse({ milestones: [{ ...validDraft.milestones[0], amountMinor: 150.5 }] }).success).toBe(false);
    expect(draftMilestonePlanSchema.safeParse({ milestones: [{ ...validDraft.milestones[0], sequence: 2 }] }).success).toBe(false);
  });

  it("rejects unsafe money values and non-HTTPS or ambiguous evidence", () => {
    expect(() => sumMoneyMinor([Number.MAX_SAFE_INTEGER, 1])).not.toThrow();
    expect(() => sumMoneyMinor([Number.MAX_SAFE_INTEGER + 1])).toThrow(RangeError);
    const base = { description: "Completed work", idempotencyKey: "d75499e7-64e7-4e8a-b902-e3c8ff6ea217" };
    expect(submitDeliverableSchema.safeParse({ ...base, evidenceUrl: "http://example.com/work" }).success).toBe(false);
    expect(submitDeliverableSchema.safeParse({ ...base, evidenceUrl: "https://example.com/work", storageObjectPath: "p/m/file.pdf" }).success).toBe(false);
  });
});
