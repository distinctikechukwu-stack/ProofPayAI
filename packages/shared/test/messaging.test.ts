import { describe, expect, it } from "vitest";
import { messageReportSchema, sendProjectMessageSchema } from "../src/index.js";

const idempotencyKey = "4a1ef4cb-86ec-4ef7-80ba-a8cc8079f533";

describe("project messaging boundary schemas", () => {
  it("requires meaningful message content and keeps attachment names path-free", () => {
    expect(sendProjectMessageSchema.safeParse({ idempotencyKey, body: "Hello about the milestone plan.", attachments: [] }).success).toBe(true);
    expect(sendProjectMessageSchema.safeParse({ idempotencyKey, body: "", attachments: [{
      path: "3f1c7828-f1dc-48b5-b7a8-60dbcd59bc76/22bba3c1-356a-4c35-aaf0-1c30ee9ac985-review.pdf",
      fileName: "review.pdf",
    }] }).success).toBe(true);
    expect(sendProjectMessageSchema.safeParse({ idempotencyKey, body: "  ", attachments: [] }).success).toBe(false);
    expect(sendProjectMessageSchema.safeParse({ idempotencyKey, body: "", attachments: [{ path: "conversation/file.pdf", fileName: "../file.pdf" }] }).success).toBe(false);
  });

  it("bounds file counts and report fields", () => {
    const attachment = { path: "conversation/asset.pdf", fileName: "asset.pdf" };
    expect(sendProjectMessageSchema.safeParse({ idempotencyKey, body: "Review these files.", attachments: Array.from({ length: 6 }, () => attachment) }).success).toBe(false);
    expect(messageReportSchema.safeParse({ reason: "harassment", details: "Repeated abusive messages." }).success).toBe(true);
    expect(messageReportSchema.safeParse({ reason: "not-a-reason", details: "" }).success).toBe(false);
  });
});
