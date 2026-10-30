import { describe, expect, it } from "vitest";
import {
  calculateHourlyAmountMinor,
  draftHourlyTimeEntrySchema,
  hourlyTimeEntryReviewSchema,
  hourlyTimerActionSchema,
  manualHourlyTimeEntrySchema,
} from "../src/index.js";

describe("hourly contract money and review schemas", () => {
  it("rounds approved hourly seconds to exact currency minor units with positive half-up arithmetic", () => {
    expect(calculateHourlyAmountMinor("9000", 3600)).toBe("9000");
    expect(calculateHourlyAmountMinor("9000", 900)).toBe("2250");
    expect(calculateHourlyAmountMinor("1", 1800)).toBe("1");
    expect(calculateHourlyAmountMinor("1", 1799)).toBe("0");
    expect(calculateHourlyAmountMinor("9007199254740993", 3600)).toBe("9007199254740993");
    expect(calculateHourlyAmountMinor("1.5", 3600)).toBeNull();
    expect(calculateHourlyAmountMinor("1", 0)).toBeNull();
  });

  it("requires exact date, integer seconds, and user-supplied idempotency for manual entries", () => {
    const input = { idempotencyKey: "6fd3ee6c-68f1-43f3-9c02-3fd9c71f6b91", workDate: "2026-10-30", durationSeconds: 3_600, description: "Review approved landing page copy" };
    expect(manualHourlyTimeEntrySchema.safeParse(input).success).toBe(true);
    expect(manualHourlyTimeEntrySchema.safeParse({ ...input, durationSeconds: 3_600.5 }).success).toBe(false);
    expect(manualHourlyTimeEntrySchema.safeParse({ ...input, workDate: "2026-02-30" }).success).toBe(false);
    expect(manualHourlyTimeEntrySchema.safeParse({ ...input, ownerId: "caller-identity" }).success).toBe(false);
  });

  it("allows full timer duration when revising a draft while manual entries stay bounded to one day", () => {
    const draft = { workDate: "2026-10-30", durationSeconds: 604_800, description: "Timer-recorded project work" };
    expect(draftHourlyTimeEntrySchema.safeParse(draft).success).toBe(true);
    expect(draftHourlyTimeEntrySchema.safeParse({ ...draft, durationSeconds: 604_801 }).success).toBe(false);
    expect(manualHourlyTimeEntrySchema.safeParse({ ...draft, idempotencyKey: "6fd3ee6c-68f1-43f3-9c02-3fd9c71f6b91" }).success).toBe(false);
  });

  it("requires a written reason for a disputed entry and accepts the timer state actions", () => {
    expect(hourlyTimeEntryReviewSchema.safeParse({ decision: "approved" }).success).toBe(true);
    expect(hourlyTimeEntryReviewSchema.safeParse({ decision: "disputed", details: "Please add the missing task details." }).success).toBe(true);
    expect(hourlyTimeEntryReviewSchema.safeParse({ decision: "disputed", details: "No" }).success).toBe(false);
    expect(hourlyTimeEntryReviewSchema.safeParse({ decision: "approve" }).success).toBe(false);
    expect(hourlyTimerActionSchema.safeParse({ action: "pause" }).success).toBe(true);
    expect(hourlyTimerActionSchema.safeParse({ action: "reset" }).success).toBe(false);
  });
});
