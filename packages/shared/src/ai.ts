import { z } from "zod";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const generateMilestonesRequestSchema = z.object({
  projectTitle: text(160),
  projectDescription: text(5_000),
  requirements: z.array(text(1_000)).min(1).max(50),
  budgetMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  deadline: z.string().nullable().optional(),
}).superRefine((project, context) => {
  if (project.deadline && !isIsoDate(project.deadline)) {
    context.addIssue({ code: "custom", path: ["deadline"], message: "Use a valid calendar date in YYYY-MM-DD format." });
  }
});

export const generatedMilestoneSchema = z.object({
  sequence: z.number().int().min(1).max(20),
  title: text(120),
  description: text(2_000),
  deliverables: z.array(text(500)).min(1).max(20),
  acceptanceCriteria: z.array(text(500)).min(1).max(20),
  completionConditions: z.array(text(500)).min(1).max(20),
  allocationWeight: z.number().int().min(1).max(10_000),
  suggestedDueInDays: z.number().int().min(1).max(365).nullable(),
  dependencySequences: z.array(z.number().int().min(1).max(20)).max(20),
});

export const generatedMilestonesSchema = z.object({
  milestones: z.array(generatedMilestoneSchema).min(1).max(20),
  rationale: text(2_000),
}).superRefine((result, context) => {
  const sequences = new Set(result.milestones.map((milestone) => milestone.sequence));
  if (sequences.size !== result.milestones.length) {
    context.addIssue({ code: "custom", path: ["milestones"], message: "Generated milestone sequences must be unique." });
  }
  for (const [index, milestone] of result.milestones.entries()) {
    for (const dependency of milestone.dependencySequences) {
      if (!sequences.has(dependency) || dependency >= milestone.sequence) {
        context.addIssue({ code: "custom", path: ["milestones", index, "dependencySequences"], message: "Dependencies must reference an earlier generated milestone." });
      }
    }
  }
});

export const scopeAnalysisSchema = z.object({
  classification: z.enum(["covered", "possibly_covered", "outside_scope", "clarification_required"]),
  summary: text(2_000),
  concerns: z.array(text(500)).max(20),
  affectedMilestoneSequences: z.array(z.number().int().min(1).max(20)).max(20),
  citations: z.array(z.object({
    source: z.enum(["agreement_scope", "requirements", "milestone", "accepted_change_order"]),
    milestoneSequence: z.number().int().min(1).max(20).nullable(),
    changeOrderVersionId: z.string().uuid().nullable(),
    exactExcerpt: text(1_200),
  })).max(20),
  proposedAmendment: z.object({
    title: text(160),
    description: text(4_000),
    deliverables: z.array(text(500)).max(20),
    openQuestions: z.array(text(500)).max(20),
    amountDeltaMinor: z.null(),
    scheduleDeltaDays: z.null(),
    estimateExplanation: text(1_000),
  }),
  uncertainty: text(1_000),
});

export const changeOrderDraftSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: text(160),
  description: text(8_000),
  amountDeltaMinor: z.number().int().safe(),
  scheduleDeltaDays: z.number().int().min(-365).max(365),
  deliverables: z.array(text(500)).max(20),
  openQuestions: z.array(text(500)).max(20),
  analysisId: z.string().uuid(),
}).superRefine((proposal, context) => {
  if (proposal.amountDeltaMinor === 0 && proposal.scheduleDeltaDays === 0 && proposal.deliverables.length === 0) {
    context.addIssue({ code: "custom", path: ["deliverables"], message: "An amendment must change the price, schedule, or deliverables." });
  }
});

export const changeOrderDecisionSchema = z.object({ decision: z.enum(["accept", "reject"]) });

export function allocateBudgetByWeight(budgetMinor: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor <= 0 || weights.length < 1 || weights.length > 20) {
    throw new RangeError("Budget must be positive minor units and include 1–20 milestone weights.");
  }
  if (budgetMinor < weights.length || weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 10_000)) {
    throw new RangeError("Each milestone must receive at least one minor unit and each weight must be valid.");
  }
  const totalWeight = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const budget = BigInt(budgetMinor);
  const allocations = weights.map((weight) => Number((budget * BigInt(weight)) / totalWeight));
  let remaining = budgetMinor - allocations.reduce((sum, amount) => sum + amount, 0);
  const order = weights.map((weight, index) => ({
    index,
    remainder: (budget * BigInt(weight)) % totalWeight,
  })).sort((left, right) => left.remainder === right.remainder
    ? left.index - right.index
    : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; remaining > 0; index++, remaining--) {
    allocations[order[index]!.index]! += 1;
  }
  if (allocations.some((amount) => amount < 1) || allocations.reduce((sum, amount) => sum + BigInt(amount), 0n) !== budget) {
    throw new RangeError("The milestone allocation could not reconcile to the project budget.");
  }
  return allocations;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export type GenerateMilestonesRequest = z.infer<typeof generateMilestonesRequestSchema>;
export type GeneratedMilestones = z.infer<typeof generatedMilestonesSchema>;
export type ScopeAnalysis = z.infer<typeof scopeAnalysisSchema>;
export type ChangeOrderDraft = z.infer<typeof changeOrderDraftSchema>;
export type ChangeOrderDecision = z.infer<typeof changeOrderDecisionSchema>;
