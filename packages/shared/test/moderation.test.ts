import { describe, expect, it } from "vitest";
import {
  accountDeletionRequestSchema,
  conversationModerationReviewSchema,
  marketplaceJobModerationReviewSchema,
  moderationQueueSchema,
} from "../src/index.js";

const id = "3f1c7828-f1dc-48b5-b7a8-60dbcd59bc76";

describe("moderation and account request schemas", () => {
  it("requires an explicit account-deletion confirmation and rejects identity overrides", () => {
    expect(accountDeletionRequestSchema.safeParse({ confirmation: "REQUEST DELETION" }).success).toBe(true);
    expect(accountDeletionRequestSchema.safeParse({ confirmation: "REQUEST DELETION", userId: id }).success).toBe(false);
    expect(accountDeletionRequestSchema.safeParse({ confirmation: "delete" }).success).toBe(false);
  });

  it("allows only the supported moderator decisions and short notes", () => {
    expect(marketplaceJobModerationReviewSchema.safeParse({ decision: "hide_listing", note: "Policy review." }).success).toBe(true);
    expect(marketplaceJobModerationReviewSchema.safeParse({ decision: "erase_account" }).success).toBe(false);
    expect(conversationModerationReviewSchema.safeParse({ decision: "escalate", note: "" }).success).toBe(true);
    expect(conversationModerationReviewSchema.safeParse({ decision: "suspend_user" }).success).toBe(false);
  });

  it("rejects malformed queue projections and user identifiers", () => {
    const queue = {
      jobReports: [{ id, jobTitle: "Landing page", reason: "spam", details: "Repeated links.", status: "pending", decision: null, resolutionNote: "", createdAt: "2026-10-30T10:00:00Z", reviewedAt: null, moderationHold: false }],
      conversationReports: [], deletionRequests: [],
    };
    expect(moderationQueueSchema.safeParse(queue).success).toBe(true);
    expect(moderationQueueSchema.safeParse({ ...queue, jobReports: [{ ...queue.jobReports[0], status: "actioned" }] }).success).toBe(true);
    expect(moderationQueueSchema.safeParse({ ...queue, jobReports: [{ ...queue.jobReports[0], reporterId: id }] }).success).toBe(false);
    expect(moderationQueueSchema.safeParse({ ...queue, deletionRequests: [{ id, displayName: "A user", status: "requested", createdAt: "invalid", reviewedAt: null, resolutionNote: "" }] }).success).toBe(false);
  });
});
