import { z } from "zod";

const uuidSchema = z.string().uuid();
const noteSchema = z.string().trim().max(2_000).default("");

export const marketplaceJobModerationReviewSchema = z.object({
  decision: z.enum(["hide_listing", "restore_listing", "no_action", "escalate"]),
  note: noteSchema,
}).strict();

export const conversationModerationReviewSchema = z.object({
  decision: z.enum(["no_action", "escalate"]),
  note: noteSchema,
}).strict();

export const accountDeletionRequestSchema = z.object({
  confirmation: z.literal("REQUEST DELETION"),
}).strict();

export const accountDeletionStatusSchema = z.object({
  id: uuidSchema,
  status: z.enum(["requested", "under_review", "cancelled", "declined"]),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  reviewed_at: z.iso.datetime().nullable(),
  resolution_note: z.string().max(2_000),
}).strict();

const moderationStatusSchema = z.enum(["pending", "reviewed"]);
const decisionSchema = z.enum(["hide_listing", "restore_listing", "no_action", "escalate"]).nullable();

export const moderationQueueSchema = z.object({
  jobReports: z.array(z.object({
    id: uuidSchema, jobTitle: z.string(), reason: z.string(), details: z.string(), status: moderationStatusSchema,
    decision: decisionSchema, resolutionNote: z.string(), createdAt: z.iso.datetime(), reviewedAt: z.iso.datetime().nullable(), moderationHold: z.boolean(),
  }).strict()).max(100),
  conversationReports: z.array(z.object({
    id: uuidSchema, projectTitle: z.string(), reason: z.string(), details: z.string(), reportedMessage: z.string(),
    status: moderationStatusSchema, decision: z.enum(["no_action", "escalate"]).nullable(), resolutionNote: z.string(),
    createdAt: z.iso.datetime(), reviewedAt: z.iso.datetime().nullable(),
  }).strict()).max(100),
  deletionRequests: z.array(z.object({
    id: uuidSchema, displayName: z.string(), status: z.enum(["requested", "under_review"]),
    createdAt: z.iso.datetime(), reviewedAt: z.iso.datetime().nullable(), resolutionNote: z.string(),
  }).strict()).max(100),
}).strict();

export type MarketplaceJobModerationReview = z.infer<typeof marketplaceJobModerationReviewSchema>;
export type ConversationModerationReview = z.infer<typeof conversationModerationReviewSchema>;
export type ModerationQueue = z.infer<typeof moderationQueueSchema>;
