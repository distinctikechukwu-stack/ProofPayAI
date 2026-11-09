import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createCloudflarePaypalWebhookHandler,
  type CloudflarePaypalWebhookEnv,
  type WorkerLogger,
} from "../src/cloudflare-paypal-webhook.js";
import type { PaypalClient } from "../src/paypal.js";
import type { SupabasePort } from "../src/supabase.js";

const event = {
  id: "WH-EVENT-TEST-001",
  event_type: "INVOICING.INVOICE.PAID",
  resource: { id: "INV2-CF-TEST-001", status: "SENT" },
};
const rawEvent = ` { "id":"${event.id}", "event_type":"${event.event_type}", "resource":{"id":"INV2-CF-TEST-001","status":"SENT"} } `;
const transmissionHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
  "paypal-transmission-id": "WH-TRANSMISSION-TEST-001",
  "paypal-transmission-sig": "synthetic-signature",
  "paypal-transmission-time": "2026-11-07T10:00:00Z",
};

function makeHarness(options: {
  verified?: boolean;
  receipt?: unknown;
  rpcError?: unknown;
  queueSendError?: unknown;
  processError?: unknown;
  batchLimitReached?: boolean;
  verifyError?: unknown;
} = {}) {
  const send = vi.fn(async () => {
    if (options.queueSendError) throw options.queueSendError;
  });
  const env: CloudflarePaypalWebhookEnv = {
    PAYPAL_SANDBOX_CLIENT_ID: "synthetic-sandbox-client-id",
    PAYPAL_SANDBOX_CLIENT_SECRET: "synthetic-sandbox-client-secret",
    PAYPAL_WEBHOOK_ID: "synthetic-sandbox-webhook-id",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
    PAYPAL_WEBHOOK_QUEUE: { send },
  };
  const rpc = vi.fn(async () => ({
    data: options.receipt ?? { duplicate: false, processed: false, pending: true },
    error: options.rpcError ?? null,
  }));
  const service = { rpc } as unknown as Pick<SupabasePort, "rpc">;
  const verifyWebhook = vi.fn(async (_event: unknown, _headers: unknown, _raw: string) => {
    if (options.verifyError) throw options.verifyError;
    return options.verified ?? true;
  });
  const showInvoice = vi.fn(async (id: string) => ({
    id,
    status: "PAID",
    invoiceNumber: null,
    invoiceUrl: null,
    paidAt: "2026-11-07T10:00:00Z",
  }));
  const paypal = { verifyWebhook, showInvoice } as unknown as Pick<PaypalClient, "verifyWebhook" | "showInvoice">;
  const processAvailable = vi.fn(async (_service: unknown, _paypal: unknown, _logger: unknown, _maxEventsPerPass?: number) => {
    if (options.processError) throw options.processError;
    return { processed: 0, batchLimitReached: options.batchLimitReached ?? false };
  });
  const loggerMocks = {
    info: vi.fn((_fields: Record<string, unknown>, _message: string) => undefined),
    warn: vi.fn((_fields: Record<string, unknown>, _message: string) => undefined),
  };
  const logger: WorkerLogger = loggerMocks;
  const handler = createCloudflarePaypalWebhookHandler({
    createPaypalClient: () => paypal,
    createServiceClient: () => service,
    processAvailable,
    logger,
  });
  return { handler, env, rpc, send, verifyWebhook, processAvailable, logger: loggerMocks };
}

function webhookRequest(body = rawEvent, path = "/api/webhooks/paypal"): Request {
  return new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...transmissionHeaders },
    body,
  });
}

describe("Cloudflare PayPal webhook ingress and queue wiring", () => {
  it("verifies the original event and durably enqueues before acknowledging", async () => {
    const harness = makeHarness();
    const response = await harness.handler.fetch(webhookRequest(), harness.env);

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ verified: true, accepted: true, duplicate: false });
    expect(harness.verifyWebhook).toHaveBeenCalledWith(event, expect.objectContaining({ transmissionId: transmissionHeaders["paypal-transmission-id"] }), rawEvent);
    expect(harness.rpc).toHaveBeenCalledWith("enqueue_verified_paypal_webhook", {
      p_provider_event_id: event.id,
      p_event_type: event.event_type,
      p_resource_id: event.resource.id,
      p_payload: event,
    });
    expect(harness.send).toHaveBeenCalledWith({ kind: "drain-verified-paypal-inbox" });
  });

  it("rejects an invalid signature without touching Supabase or the queue", async () => {
    const harness = makeHarness({ verified: false });
    const response = await harness.handler.fetch(webhookRequest(), harness.env);
    expect(response.status).toBe(400);
    expect(harness.rpc).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("returns a safe retryable response and logs no provider details when verification fails", async () => {
    const sensitiveDiagnostic = "synthetic-secret-and-private-payload";
    const harness = makeHarness({ verifyError: new Error(sensitiveDiagnostic) });
    const response = await harness.handler.fetch(webhookRequest(), harness.env);

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(sensitiveDiagnostic);
    expect(JSON.stringify(harness.logger.warn.mock.calls)).not.toContain(sensitiveDiagnostic);
    expect(harness.logger.warn).toHaveBeenCalledWith(
      { stage: "signature_verification", errorCode: "provider_unavailable" },
      expect.any(String),
    );
    expect(harness.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed events and incomplete signature headers", async () => {
    const harness = makeHarness();
    const malformed = await harness.handler.fetch(webhookRequest("not-json"), harness.env);
    expect(malformed.status).toBe(400);
    const noSignature = new Request("https://worker.example/api/webhooks/paypal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawEvent,
    });
    const missing = await harness.handler.fetch(noSignature, harness.env);
    expect(missing.status).toBe(400);
    expect(harness.verifyWebhook).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("rejects non-Sandbox or credential-bearing certificate URLs before calling PayPal", async () => {
    const harness = makeHarness();
    for (const certUrl of [
      "https://attacker.example/certificate",
      "https://user:password@api-m.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
    ]) {
      const unsafeRequest = new Request("https://worker.example/api/webhooks/paypal", {
        method: "POST",
        headers: { "content-type": "application/json", ...transmissionHeaders, "paypal-cert-url": certUrl },
        body: rawEvent,
      });
      const response = await harness.handler.fetch(unsafeRequest, harness.env);
      expect(response.status).toBe(400);
    }
    expect(harness.verifyWebhook).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });
  it("limits request size before parsing or provider verification", async () => {
    const harness = makeHarness();
    const huge = " ".repeat(256 * 1024 + 1);
    const response = await harness.handler.fetch(webhookRequest(huge), harness.env);
    expect(response.status).toBe(413);
    expect(harness.verifyWebhook).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("verifies unsupported events but does not store or queue them", async () => {
    const harness = makeHarness();
    const unsupported = JSON.stringify({ ...event, event_type: "PAYMENT.CAPTURE.COMPLETED" });
    const response = await harness.handler.fetch(webhookRequest(unsupported), harness.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true, accepted: false });
    expect(harness.verifyWebhook).toHaveBeenCalledOnce();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("treats an identical pending duplicate as an idempotent wake-up", async () => {
    const harness = makeHarness({ receipt: { duplicate: true, processed: false, pending: true } });
    const response = await harness.handler.fetch(webhookRequest(), harness.env);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ duplicate: true, accepted: true });
    expect(harness.send).toHaveBeenCalledOnce();
  });

  it("does not wake already processed or dead-lettered duplicates", async () => {
    const harness = makeHarness({ receipt: { duplicate: true, processed: true, pending: false } });
    const response = await harness.handler.fetch(webhookRequest(), harness.env);
    expect(response.status).toBe(202);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("does not acknowledge a verified event when its durable enqueue fails", async () => {
    const harness = makeHarness({ rpcError: { code: "08006", message: "synthetic database failure" } });
    const response = await harness.handler.fetch(webhookRequest(), harness.env);
    expect(response.status).toBe(503);
    const responseBody = await response.text();
    expect(responseBody).not.toContain("synthetic database failure");
    expect(responseBody).not.toContain("synthetic-service-role-key");
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("acknowledges after the DB commit if the wake signal send fails", async () => {
    const harness = makeHarness({ queueSendError: new Error("synthetic queue unavailable") });
    const response = await harness.handler.fetch(webhookRequest(), harness.env);
    expect(response.status).toBe(202);
    expect(harness.rpc).toHaveBeenCalledOnce();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      { stage: "queue_notification", errorCode: "send_failed" },
      expect.any(String),
    );
  });

  it("retries a failed Queue consumer invocation for Cloudflare retry and DLQ handling", async () => {
    const harness = makeHarness({ processError: new Error("synthetic processor failure") });
    const message = { body: { arbitrary: "ignored" }, ack: vi.fn(), retry: vi.fn() };
    await harness.handler.queue({ messages: [message] }, harness.env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("acks completed wake hints and schedules immediate continuation at the bounded batch limit", async () => {
    const harness = makeHarness({ batchLimitReached: true });
    const message = { body: { kind: "drain-verified-paypal-inbox" }, ack: vi.fn(), retry: vi.fn() };
    await harness.handler.queue({ messages: [message] }, harness.env);
    expect(harness.processAvailable).toHaveBeenCalledOnce();
    expect(harness.processAvailable.mock.calls[0]?.[3]).toBe(8);
    expect(harness.send).toHaveBeenCalledWith({ kind: "drain-verified-paypal-inbox" });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("uses a scheduled DB sweep to recover missed queue notifications without Render", async () => {
    const harness = makeHarness();
    await harness.handler.scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, harness.env);
    expect(harness.processAvailable).toHaveBeenCalledOnce();
    expect(harness.processAvailable.mock.calls[0]?.[3]).toBe(1);
    expect(harness.env).not.toHaveProperty("RENDER_API_URL");
  });

  it("exposes only a configuration-presence health result", async () => {
    const harness = makeHarness();
    const response = await harness.handler.fetch(new Request("https://worker.example/health"), harness.env);
    expect(response.status).toBe(200);
    const health = await response.json();
    expect(health).toEqual({ status: "ok", configured: true });
    const output = JSON.stringify(health);
    expect(output).not.toContain("synthetic-service-role-key");
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when required server-side secrets or the Queue binding are missing", async () => {
    const harness = makeHarness();
    const incompleteEnv = { ...harness.env };
    delete incompleteEnv.PAYPAL_WEBHOOK_ID;
    delete incompleteEnv.PAYPAL_WEBHOOK_QUEUE;
    const response = await harness.handler.fetch(webhookRequest(), incompleteEnv);
    expect(response.status).toBe(503);
    expect(harness.verifyWebhook).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});

describe("Cloudflare deployment configuration", () => {
  const configPath = fileURLToPath(new URL("../../cloudflare-paypal-webhook/wrangler.jsonc", import.meta.url));
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    main: string;
    compatibility_flags: string[];
    secrets: { required: string[] };
    queues: {
      producers: Array<{ binding: string; queue: string }>;
      consumers: Array<{ queue: string; max_batch_size: number; max_retries: number; dead_letter_queue: string; max_concurrency: number }>;
    };
    triggers: { crons: string[] };
  };

  it("binds the staging Worker to the verified inbox, bounded Queues retry/DLQ, and minute recovery", () => {
    expect(config.main).toBe("../api/src/cloudflare-paypal-webhook.ts");
    expect(config.compatibility_flags).toContain("nodejs_compat");
    expect(config.queues.producers).toEqual([{ binding: "PAYPAL_WEBHOOK_QUEUE", queue: "proofpay-staging-paypal-events" }]);
    expect(config.queues.consumers).toEqual([expect.objectContaining({
      queue: "proofpay-staging-paypal-events",
      max_batch_size: 1,
      max_retries: 5,
      dead_letter_queue: "proofpay-staging-paypal-events-dlq",
      max_concurrency: 1,
    })]);
    expect(config.triggers.crons).toEqual(["* * * * *"]);
  });

  it("declares only required secrets and keeps their values out of Wrangler config", () => {
    expect(config.secrets.required).toEqual([
      "PAYPAL_SANDBOX_CLIENT_ID",
      "PAYPAL_SANDBOX_CLIENT_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(config.secrets.required).not.toContain("PAYPAL_WEBHOOK_ID");
    const rawConfig = readFileSync(configPath, "utf8");
    expect(rawConfig).not.toMatch(/(client_secret|service_role_key|webhook_id)\s*[:=]\s*[A-Za-z0-9_-]{12,}/i);
  });
});
