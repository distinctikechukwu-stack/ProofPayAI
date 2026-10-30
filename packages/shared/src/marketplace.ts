import { z } from "zod";

const moneyMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const tags = (max: number, maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(max)
  .refine((items) => new Set(items.map((item) => item.toLowerCase())).size === items.length, "Remove duplicate entries.");

export const marketplaceJobInputSchema = z.object({
  id: z.string().uuid().nullable(),
  idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(5).max(160),
  summary: z.string().trim().min(10).max(240),
  description: z.string().trim().min(30).max(8000),
  requirements: tags(30, 500).min(1),
  skills: tags(20, 40),
  category: z.string().trim().min(2).max(80),
  experienceLevel: z.enum(["entry", "intermediate", "expert"]),
  projectType: z.enum(["fixed", "hourly"]),
  fixedBudgetMinor: moneyMinor.nullable(),
  hourlyRateMinMinor: moneyMinor.nullable(),
  hourlyRateMaxMinor: moneyMinor.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  estimatedDays: z.number().int().positive().max(3650).nullable(),
}).strict().superRefine((job, context) => {
  if (job.projectType === "fixed" && (job.fixedBudgetMinor === null || job.hourlyRateMinMinor !== null || job.hourlyRateMaxMinor !== null)) {
    context.addIssue({ code: "custom", message: "Fixed-price jobs need one exact budget and no hourly range." });
  }
  if (job.projectType === "hourly" && (job.fixedBudgetMinor !== null || job.hourlyRateMinMinor === null || job.hourlyRateMaxMinor === null || job.hourlyRateMinMinor > job.hourlyRateMaxMinor)) {
    context.addIssue({ code: "custom", message: "Hourly jobs need a valid rate range and no fixed budget." });
  }
});

export const marketplaceJobStatusSchema = z.object({ action: z.enum(["publish", "close", "reopen", "archive", "delete"]) }).strict();
export const marketplaceJobSearchSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  experienceLevel: z.enum(["entry", "intermediate", "expert"]).optional(),
  projectType: z.enum(["fixed", "hourly"]).optional(),
  skill: z.string().trim().max(40).optional(),
  budgetMinMinor: z.string().regex(/^\d+$/).optional(),
  budgetMaxMinor: z.string().regex(/^\d+$/).optional(),
  sort: z.enum(["recent", "budget_low", "budget_high"]).default("recent"),
  savedOnly: z.enum(["true", "false"]).default("false"),
}).strict();

export const marketplaceJobFavoriteSchema = z.object({ saved: z.boolean() }).strict();
export const marketplaceJobReportSchema = z.object({
  reason: z.enum(["suspicious", "misleading", "prohibited", "other"]),
  details: z.string().trim().max(2000).default(""),
}).strict();

export const marketplaceProposalInputSchema = z.object({
  coverLetter: z.string().trim().min(30).max(5000),
  quoteMinor: moneyMinor,
  timelineDays: z.number().int().positive().max(3650),
  portfolioItemIds: z.array(z.string().uuid()).max(12).default([]),
}).strict();

export const marketplaceProposalReviewSchema = z.object({ action: z.enum(["shortlist", "reject", "invite_interview"]) }).strict();
export const marketplaceProposalActionSchema = z.object({ action: z.enum(["submit", "withdraw", "shortlist", "reject", "invite_interview"]) }).strict();
export const marketplaceOfferInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  terms: z.string().trim().min(20).max(5000),
  amountMinor: moneyMinor,
  currency: z.string().regex(/^[A-Z]{3}$/),
  timelineDays: z.number().int().positive().max(3650),
}).strict();
export const marketplaceOfferDecisionSchema = z.object({ decision: z.enum(["accept", "decline"]) }).strict();

export const freelancerServiceInputSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(5).max(140),
  slug: z.string().trim().toLowerCase().min(3).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(30).max(5000),
  category: z.string().trim().min(2).max(80),
  startingPriceMinor: moneyMinor,
  currency: z.string().regex(/^[A-Z]{3}$/),
  deliveryDays: z.number().int().positive().max(365),
  deliverables: tags(20, 500).min(1),
  packages: z.array(z.object({
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(5).max(500),
    priceMinor: moneyMinor,
    deliveryDays: z.number().int().positive().max(365),
    deliverables: tags(20, 300).min(1),
  }).strict()).min(1).max(3),
  portfolioItemIds: z.array(z.string().uuid()).max(12).default([]),
  isPublic: z.boolean(),
}).strict();

export const freelancerServiceStatusSchema = z.object({ action: z.enum(["publish", "unpublish", "archive"]) }).strict();
export const serviceHiringRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  requestText: z.string().trim().min(20).max(4000),
  budgetMinor: moneyMinor.nullable(),
}).strict();
export const serviceHiringDecisionSchema = z.object({ decision: z.enum(["accept", "decline"]) }).strict();
export const publicFreelancerServiceSchema = z.object({
  id: z.string().uuid(),
  freelancerSlug: z.string(),
  freelancerName: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  startingPriceMinor: z.string().regex(/^\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  deliveryDays: z.number().int().positive(),
  deliverables: z.array(z.string()),
  packages: z.array(z.object({
    title: z.string(), description: z.string(), priceMinor: z.string().regex(/^\d+$/),
    deliveryDays: z.number().int().positive(), deliverables: z.array(z.string()),
  }).strict()),
}).strict();

export type MarketplaceJobInput = z.infer<typeof marketplaceJobInputSchema>;
export type MarketplaceProposalInput = z.infer<typeof marketplaceProposalInputSchema>;
export type FreelancerServiceInput = z.infer<typeof freelancerServiceInputSchema>;
export type PublicFreelancerService = z.infer<typeof publicFreelancerServiceSchema>;
