import { z } from "zod";

const uuidSchema = z.string().uuid();

export const manualHourlyTimeEntrySchema = z.object({
  idempotencyKey: uuidSchema,
  workDate: z.iso.date(),
  durationSeconds: z.number().int().min(1).max(86_400),
  description: z.string().trim().min(1).max(1_600),
}).strict();

export const draftHourlyTimeEntrySchema = z.object({
  workDate: z.iso.date(),
  durationSeconds: z.number().int().min(1).max(604_800),
  description: z.string().trim().min(1).max(1_600),
}).strict();

export const hourlyTimeEntryReviewSchema = z.object({
  decision: z.enum(["approved", "disputed"]),
  details: z.string().trim().max(2_000).default(""),
}).strict().superRefine((value, context) => {
  if (value.decision === "disputed" && value.details.length < 8) {
    context.addIssue({ code: "custom", path: ["details"], message: "Add a clear reason before disputing a time entry." });
  }
});

export const hourlyTimerStartSchema = z.object({
  description: z.string().trim().min(1).max(1_600),
}).strict();

export const hourlyTimerActionSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
}).strict();

export const hourlyProjectIdSchema = z.object({ projectId: uuidSchema }).strict();

export type ManualHourlyTimeEntry = z.infer<typeof manualHourlyTimeEntrySchema>;
export type DraftHourlyTimeEntry = z.infer<typeof draftHourlyTimeEntrySchema>;
export type HourlyTimeEntryReview = z.infer<typeof hourlyTimeEntryReviewSchema>;
export type HourlyTimerStart = z.infer<typeof hourlyTimerStartSchema>;
export type HourlyTimerAction = z.infer<typeof hourlyTimerActionSchema>;

/** Positive hourly-rate minor units multiplied by seconds, rounded half-up to a currency minor unit. */
export function calculateHourlyAmountMinor(rateMinor: string, durationSeconds: number): string | null {
  if (!/^[1-9]\d*$/.test(rateMinor) || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) return null;
  try {
    const numerator = BigInt(rateMinor) * BigInt(durationSeconds);
    return ((numerator + 1_800n) / 3_600n).toString();
  } catch {
    return null;
  }
}
