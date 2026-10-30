import { z } from "zod";

export const conversationStartSchema = z.object({ projectId: z.string().uuid() }).strict();

const attachmentSchema = z.object({
  path: z.string().trim().max(512).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._ -]{1,180}$/i),
  fileName: z.string().trim().min(1).max(180).refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value), "Attachment names must not contain paths or control characters."),
}).strict();

export const sendProjectMessageSchema = z.object({
  idempotencyKey: z.string().uuid(),
  body: z.string().trim().max(5_000),
  attachments: z.array(attachmentSchema).max(5).default([]),
}).strict().superRefine((message, context) => {
  if (!message.body && message.attachments.length === 0) {
    context.addIssue({ code: "custom", path: ["body"], message: "Write a message or attach a file." });
  }
});

export const messageSearchSchema = z.object({
  search: z.string().trim().max(120).default(""),
}).strict();

export const messageReportSchema = z.object({
  messageId: z.string().uuid().nullable().default(null),
  reason: z.enum(["harassment", "spam", "unsafe_attachment", "other"]),
  details: z.string().trim().max(2_000).default(""),
}).strict();

export const blockConversationSchema = z.object({ action: z.enum(["block", "unblock"]) }).strict();

export type SendProjectMessage = z.infer<typeof sendProjectMessageSchema>;
export type MessageReport = z.infer<typeof messageReportSchema>;
