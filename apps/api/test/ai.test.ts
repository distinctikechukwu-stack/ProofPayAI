import { describe, expect, it } from "vitest";
import { AiEvidenceError, verifyScopeEvidence } from "../src/ai.js";
import type { ScopeAnalysis } from "@proofpay/shared";

const baseAnalysis: ScopeAnalysis = {
  classification: "possibly_covered",
  summary: "The request may overlap with the agreed scope.",
  concerns: [],
  affectedMilestoneSequences: [1],
  citations: [
    { source: "agreement_scope", milestoneSequence: null, changeOrderVersionId: null, exactExcerpt: "five pages" },
    { source: "requirements", milestoneSequence: null, changeOrderVersionId: null, exactExcerpt: "mobile and desktop" },
    { source: "milestone", milestoneSequence: 1, changeOrderVersionId: null, exactExcerpt: "Responsive website" },
  ],
  proposedAmendment: {
    title: "Clarify the requested work",
    description: "Confirm the work before amending the agreement.",
    deliverables: [],
    openQuestions: ["What interaction is needed?"],
    amountDeltaMinor: null,
    scheduleDeltaDays: null,
    estimateExplanation: "No negotiated price or schedule is available.",
  },
  uncertainty: "The agreement does not describe the requested interaction.",
};

const evidence = {
  scopeText: "Build a marketing site with five pages.",
  requirements: ["Responsive on mobile and desktop."],
  milestones: [{ sequence: 1, sourceText: "Build site\nImplement five pages.\nResponsive website\nAll five pages load\nClient approves" }],
  acceptedChangeOrders: [{ id: "6de201bd-171c-4a35-9876-6302163f034a", sourceText: "Calendar amendment\nAdd monthly booking calendar\nCalendar" }],
};

describe("AI scope evidence validation", () => {
  it("accepts exact excerpts from the right agreement evidence", () => {
    expect(() => verifyScopeEvidence(baseAnalysis, evidence)).not.toThrow();
  });

  it("rejects invented excerpts and references to missing milestone sequences", () => {
    expect(() => verifyScopeEvidence({
      ...baseAnalysis,
      citations: [{ source: "agreement_scope", milestoneSequence: null, exactExcerpt: "automatic payments" }],
    }, evidence)).toThrow(AiEvidenceError);
    expect(() => verifyScopeEvidence({ ...baseAnalysis, affectedMilestoneSequences: [7] }, evidence)).toThrow(AiEvidenceError);
    expect(() => verifyScopeEvidence({
      ...baseAnalysis,
      citations: [{ source: "accepted_change_order", milestoneSequence: null, changeOrderVersionId: "6de201bd-171c-4a35-9876-6302163f034a", exactExcerpt: "monthly booking calendar" }],
    }, evidence)).not.toThrow();
    expect(() => verifyScopeEvidence({
      ...baseAnalysis,
      citations: [{ source: "accepted_change_order", milestoneSequence: null, changeOrderVersionId: "6de201bd-171c-4a35-9876-6302163f034a", exactExcerpt: "guaranteed escrow" }],
    }, evidence)).toThrow(AiEvidenceError);
  });
});
