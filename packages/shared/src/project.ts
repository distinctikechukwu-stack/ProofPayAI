import { z } from "zod";

const nonBlank = (maximum: number) => z.string().trim().min(1).max(maximum);

export const milestoneDraftSchema = z.object({
  sequence: z.number().int().min(1).max(20),
  title: nonBlank(120),
  description: nonBlank(2_000),
  deliverables: z.array(nonBlank(500)).min(1).max(20),
  acceptanceCriteria: z.array(nonBlank(500)).min(1).max(20),
  completionConditions: z.array(nonBlank(500)).min(1).max(20),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  dueDate: z.string().nullable().optional(),
  dependencySequences: z.array(z.number().int().min(1).max(20)).max(20).default([]),
}).superRefine((milestone, context) => {
  if (milestone.dueDate !== undefined && milestone.dueDate !== null && !isIsoDate(milestone.dueDate)) {
    context.addIssue({ code: "custom", path: ["dueDate"], message: "Use a valid calendar date in YYYY-MM-DD format." });
  }
});

export const createProjectDraftSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: nonBlank(160),
  description: nonBlank(5_000),
  clientName: nonBlank(160),
  budgetMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  dueDate: z.string().nullable().optional(),
  requirements: z.array(nonBlank(1_000)).min(1).max(50),
  milestones: z.array(milestoneDraftSchema).min(1).max(20),
}).superRefine((project, context) => {
  if (project.dueDate !== undefined && project.dueDate !== null && !isIsoDate(project.dueDate)) {
    context.addIssue({ code: "custom", path: ["dueDate"], message: "Use a valid calendar date in YYYY-MM-DD format." });
  }

  const total = project.milestones.reduce((sum, milestone) => sum + BigInt(milestone.amountMinor), 0n);
  if (total !== BigInt(project.budgetMinor)) {
    context.addIssue({ code: "custom", path: ["milestones"], message: "Milestone amounts must equal the project budget exactly." });
  }

  const sequences = new Set(project.milestones.map((milestone) => milestone.sequence));
  if (sequences.size !== project.milestones.length) {
    context.addIssue({ code: "custom", path: ["milestones"], message: "Milestone sequence numbers must be unique." });
  }
  for (const [index, milestone] of project.milestones.entries()) {
    for (const dependency of milestone.dependencySequences) {
      if (!sequences.has(dependency) || dependency >= milestone.sequence) {
        context.addIssue({ code: "custom", path: ["milestones", index, "dependencySequences"], message: "Dependencies must reference an earlier milestone in this project." });
      }
    }
  }
});

export const draftMilestonePlanSchema = z.object({
  milestones: z.array(milestoneDraftSchema).min(1).max(20),
}).strict().superRefine((plan, context) => {
  const sequences = new Set(plan.milestones.map((milestone) => milestone.sequence));
  if (sequences.size !== plan.milestones.length) {
    context.addIssue({ code: "custom", path: ["milestones"], message: "Milestone sequence numbers must be unique." });
  }
  for (const [index, milestone] of plan.milestones.entries()) {
    if (milestone.sequence !== index + 1) {
      context.addIssue({ code: "custom", path: ["milestones", index, "sequence"], message: "Draft milestones must be ordered from 1 without gaps." });
    }
    for (const dependency of milestone.dependencySequences) {
      if (!sequences.has(dependency) || dependency >= milestone.sequence) {
        context.addIssue({ code: "custom", path: ["milestones", index, "dependencySequences"], message: "Dependencies must reference an earlier milestone in this project." });
      }
    }
  }
});

export const addProjectClientSchema = z.object({
  userId: z.string().uuid(),
});

export const submitDeliverableSchema = z.object({
  description: nonBlank(2_000),
  evidenceUrl: z.string().url().max(2_048).nullable().optional(),
  storageObjectPath: z.string().trim().min(1).max(512).nullable().optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((submission, context) => {
  const hasUrl = Boolean(submission.evidenceUrl);
  const hasPath = Boolean(submission.storageObjectPath);
  if (hasUrl === hasPath) {
    context.addIssue({ code: "custom", path: ["evidenceUrl"], message: "Provide exactly one secure URL or private storage object path." });
  }
  if (submission.evidenceUrl && new URL(submission.evidenceUrl).protocol !== "https:") {
    context.addIssue({ code: "custom", path: ["evidenceUrl"], message: "Deliverable links must use HTTPS." });
  }
});

export const milestoneReviewSchema = z.object({
  decision: z.enum(["approved", "request_revision"]),
  note: z.string().trim().max(4_000).default(""),
  idempotencyKey: z.string().uuid(),
}).superRefine((review, context) => {
  if (review.decision === "request_revision" && review.note.length < 3) {
    context.addIssue({ code: "custom", path: ["note"], message: "Add a short explanation when requesting a revision." });
  }
});

export const scopeRequestSchema = z.object({
  requestText: nonBlank(6_000),
  idempotencyKey: z.string().uuid(),
});

export function sumMoneyMinor(amounts: readonly number[]): bigint {
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    throw new RangeError("Money amounts must be non-negative safe integer minor units.");
  }
  return amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export type CreateProjectDraft = z.infer<typeof createProjectDraftSchema>;
export type MilestoneDraft = z.infer<typeof milestoneDraftSchema>;
export type DraftMilestonePlan = z.infer<typeof draftMilestonePlanSchema>;
