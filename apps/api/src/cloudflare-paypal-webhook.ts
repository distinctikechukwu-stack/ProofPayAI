import { z } from "zod";
import {
  createAuditSupabase,
  type SupabasePort,
} from "./supabase.js";
import {
  PaypalClient,
  type PaypalConfig,
} from "./paypal.js";
import { PaypalWebhookWorker } from "./paypal-webhook-worker.js";

const STAGING_SUPABASE_URL = "https://whdvvbwirfmdubrlzaxo.supabase.co";
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const WEBHOOK_VERIFY_TIMEOUT_MS = 17_000;
const WEBHOOK_ENQUEUE_TIMEOUT_MS = 5_000;
const QUEUE_WAKE_TIMEOUT_MS = 2_000;
const CLOUDFLARE_QUEUE_DRAIN_LIMIT = 8;
const WAKE_MESSAGE = { kind: "drain-verified-paypal-inbox" } as const;

const paypalEventSchema = z.object({
  id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(120),
  resource: z.object({ id: z.string().min(1).max(255) }).passthrough(),
}).passthrough();
const enqueueReceiptSchema = z.object({
  duplicate: z.boolean(),
  processed: z.boolean(),
  pending: z.boolean(),
});
const transmissionTimeSchema = z.string().datetime({ offset: true });
const supportedEvents = new Set([
  "INVOICING.INVOICE.CREATED",
  "INVOICING.INVOICE.SENT",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.SCHEDULED",
]);

export interface CloudflareQueueProducer {
  send(body: unknown): Promise<unknown>;
}

export interface CloudflarePaypalWebhookEnv {
  PAYPAL_SANDBOX_CLIENT_ID?: string;
  PAYPAL_SANDBOX_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PAYPAL_WEBHOOK_QUEUE?: CloudflareQueueProducer;
}

export interface CloudflareQueueMessage {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface CloudflareQueueBatch {
  messages: CloudflareQueueMessage[];
}

export interface CloudflareScheduledController {
  cron: string;
  scheduledTime: number;
}

export interface WorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

type PaypalPort = Pick<PaypalClient, "verifyWebhook" | "showInvoice">;
type ServicePort = Pick<SupabasePort, "rpc">;
type QueuePassResult = Awaited<ReturnType<PaypalWebhookWorker["processAvailable"]>>;
type ProcessAvailable = (service: ServicePort, paypal: PaypalPort, logger: WorkerLogger, maxEventsPerPass?: number) => Promise<QueuePassResult>;

export interface CloudflarePaypalWebhookDependencies {
  createPaypalClient(env: CloudflarePaypalWebhookEnv): PaypalPort;
  createServiceClient(env: CloudflarePaypalWebhookEnv): ServicePort;
  processAvailable: ProcessAvailable;
  logger: WorkerLogger;
}

export interface CloudflarePaypalWebhookHandler {
  fetch(request: Request, env: CloudflarePaypalWebhookEnv): Promise<Response>;
  queue(batch: CloudflareQueueBatch, env: CloudflarePaypalWebhookEnv): Promise<void>;
  scheduled(controller: CloudflareScheduledController, env: CloudflarePaypalWebhookEnv): Promise<void>;
}

export function createCloudflarePaypalWebhookHandler(
  overrides: Partial<CloudflarePaypalWebhookDependencies> = {},
): CloudflarePaypalWebhookHandler {
  const dependencies: CloudflarePaypalWebhookDependencies = {
    createPaypalClient: (env) => new PaypalClient(paypalConfigFromBindings(env)),
    createServiceClient: (env) => createAuditSupabase(STAGING_SUPABASE_URL, requiredSecret(env.SUPABASE_SERVICE_ROLE_KEY)),
    processAvailable: (service, paypal, logger, maxEventsPerPass) => new PaypalWebhookWorker(
      service,
      paypal,
      logger,
      maxEventsPerPass === undefined ? {} : { maxEventsPerPass },
    ).processAvailable(),
    logger: {
      info: (fields, message) => console.info(message, safeLogFields(fields)),
      warn: (fields, message) => console.warn(message, safeLogFields(fields)),
    },
    ...overrides,
  };

  async function drainInbox(env: CloudflarePaypalWebhookEnv, maxEventsPerPass?: number): Promise<QueuePassResult> {
    if (!isConfigured(env)) throw new Error("worker_not_configured");
    const result = await dependencies.processAvailable(
      dependencies.createServiceClient(env),
      dependencies.createPaypalClient(env),
      dependencies.logger,
      maxEventsPerPass,
    );
    if (result.batchLimitReached) {
      await withTimeout(env.PAYPAL_WEBHOOK_QUEUE!.send(WAKE_MESSAGE), QUEUE_WAKE_TIMEOUT_MS);
    }
    return result;
  }

  return {
    async fetch(request, env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse({ status: "ok", configured: isConfigured(env) }, 200);
      }
      if (url.pathname !== "/api/webhooks/paypal") return jsonResponse({ error: "Not found." }, 404);
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
      if (!isConfigured(env)) return jsonResponse({ error: "PayPal Sandbox webhook processing is not configured." }, 503);
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return jsonResponse({ error: "A JSON PayPal webhook body is required." }, 415);
      }

      const body = await readBoundedBody(request);
      if (body.kind === "too_large") return jsonResponse({ error: "The PayPal webhook body is too large." }, 413);
      if (body.kind !== "ok") return jsonResponse({ error: "A valid PayPal webhook event body is required." }, 400);
      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(body.text) as unknown;
      } catch {
        return jsonResponse({ error: "A valid PayPal webhook event body is required." }, 400);
      }
      const parsed = paypalEventSchema.safeParse(rawEvent);
      if (!parsed.success) return jsonResponse({ error: "A valid PayPal webhook event body is required." }, 400);

      const transmission = {
        authAlgo: boundedHeader(request, "paypal-auth-algo", 100),
        certUrl: boundedHeader(request, "paypal-cert-url", 2_048),
        transmissionId: boundedHeader(request, "paypal-transmission-id", 255),
        transmissionSignature: boundedHeader(request, "paypal-transmission-sig", 4_096),
        transmissionTime: boundedHeader(request, "paypal-transmission-time", 100),
      };
      if (Object.values(transmission).some((value) => value === null)) {
        return jsonResponse({ error: "PayPal signature headers are incomplete." }, 400);
      }
      if (!isTrustedSandboxCertificateUrl(transmission.certUrl!)) {
        return jsonResponse({ error: "PayPal signature certificate URL is not trusted." }, 400);
      }
      if (!transmissionTimeSchema.safeParse(transmission.transmissionTime).success) {
        return jsonResponse({ error: "The PayPal transmission timestamp is invalid." }, 400);
      }

      let verified = false;
      try {
        verified = await withTimeout(
          dependencies.createPaypalClient(env).verifyWebhook(
            parsed.data,
            transmission as {
              authAlgo: string;
              certUrl: string;
              transmissionId: string;
              transmissionSignature: string;
              transmissionTime: string;
            },
            body.text,
          ),
          WEBHOOK_VERIFY_TIMEOUT_MS,
        );
      } catch {
        dependencies.logger.warn({ stage: "signature_verification", errorCode: "provider_unavailable" }, "PayPal webhook signature verification did not complete");
        return jsonResponse({ error: "PayPal signature verification is temporarily unavailable." }, 503);
      }
      if (!verified) return jsonResponse({ error: "PayPal webhook signature verification failed." }, 400);
      if (!supportedEvents.has(parsed.data.event_type)) {
        return jsonResponse({ verified: true, accepted: false }, 200);
      }

      let queued: { data: unknown; error: unknown | null };
      try {
        queued = await withTimeout(
          dependencies.createServiceClient(env).rpc("enqueue_verified_paypal_webhook", {
            p_provider_event_id: parsed.data.id,
            p_event_type: parsed.data.event_type,
            p_resource_id: parsed.data.resource.id,
            p_payload: parsed.data,
          }),
          WEBHOOK_ENQUEUE_TIMEOUT_MS,
        );
      } catch {
        dependencies.logger.warn({ stage: "durable_enqueue", errorCode: "timeout" }, "Verified PayPal event was not confirmed in durable storage");
        return jsonResponse({ error: "The verified PayPal event was not confirmed in durable storage. PayPal may retry delivery." }, 503);
      }
      if (queued.error) {
        dependencies.logger.warn({ stage: "durable_enqueue", errorCode: safeErrorCode(queued.error) }, "Verified PayPal event could not be stored");
        return jsonResponse({ error: "The verified PayPal event could not be stored. PayPal may retry delivery." }, 503);
      }
      const receipt = enqueueReceiptSchema.safeParse(queued.data);
      if (!receipt.success) {
        dependencies.logger.warn({ stage: "durable_enqueue", errorCode: "invalid_receipt" }, "PayPal event storage returned an unconfirmed receipt");
        return jsonResponse({ error: "The verified PayPal event storage result could not be confirmed. PayPal may retry delivery." }, 503);
      }

      if (receipt.data.pending) {
        try {
          await withTimeout(env.PAYPAL_WEBHOOK_QUEUE!.send(WAKE_MESSAGE), QUEUE_WAKE_TIMEOUT_MS);
        } catch {
          // The verified event is already durable in Supabase. Cron recovery is authoritative.
          dependencies.logger.warn({ stage: "queue_notification", errorCode: "send_failed" }, "Verified PayPal event is durable; scheduled recovery will drain it");
        }
      }
      return jsonResponse({ verified: true, accepted: true, duplicate: receipt.data.duplicate }, 202);
    },

    async queue(batch, env): Promise<void> {
      if (!isConfigured(env)) {
        retryMessages(batch.messages);
        return;
      }
      try {
        await drainInbox(env, CLOUDFLARE_QUEUE_DRAIN_LIMIT);
        for (const message of batch.messages) message.ack();
      } catch {
        dependencies.logger.warn({ stage: "queue_consumer", errorCode: "drain_failed" }, "PayPal inbox drain failed; Cloudflare Queues will retry the wake signal");
        retryMessages(batch.messages);
      }
    },

    async scheduled(_controller, env): Promise<void> {
      if (!isConfigured(env)) {
        dependencies.logger.warn({ stage: "scheduled_recovery", errorCode: "not_configured" }, "PayPal inbox scheduled recovery is not configured");
        return;
      }
      try {
        await drainInbox(env, 1);
      } catch {
        dependencies.logger.warn({ stage: "scheduled_recovery", errorCode: "drain_failed" }, "PayPal inbox scheduled recovery failed; pending events remain durable");
      }
    },
  };
}

function paypalConfigFromBindings(env: CloudflarePaypalWebhookEnv): PaypalConfig {
  return {
    clientId: requiredSecret(env.PAYPAL_SANDBOX_CLIENT_ID),
    clientSecret: requiredSecret(env.PAYPAL_SANDBOX_CLIENT_SECRET),
    webhookId: requiredSecret(env.PAYPAL_WEBHOOK_ID),
  };
}

function requiredSecret(value: string | undefined): string {
  if (!isRealSecret(value)) throw new Error("worker_not_configured");
  return value.trim();
}

function isRealSecret(value: string | undefined): value is string {
  return Boolean(value?.trim() && !/^your[-_]/i.test(value.trim()));
}

function isConfigured(env: CloudflarePaypalWebhookEnv): boolean {
  return isRealSecret(env.PAYPAL_SANDBOX_CLIENT_ID)
    && isRealSecret(env.PAYPAL_SANDBOX_CLIENT_SECRET)
    && isRealSecret(env.PAYPAL_WEBHOOK_ID)
    && isRealSecret(env.SUPABASE_SERVICE_ROLE_KEY)
    && Boolean(env.PAYPAL_WEBHOOK_QUEUE);
}

async function readBoundedBody(request: Request): Promise<{ kind: "ok"; text: string } | { kind: "invalid" | "too_large" }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) return { kind: "too_large" };
  if (!request.body) return { kind: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      chunks.push(result.value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { kind: "invalid" };
  }
}

function isTrustedSandboxCertificateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "api-m.sandbox.paypal.com"
      && url.port === ""
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

function boundedHeader(request: Request, name: string, maxLength: number): string | null {
  const value = request.headers.get(name)?.trim();
  return value && value.length <= maxLength ? value : null;
}

function retryMessages(messages: CloudflareQueueMessage[]): void {
  for (const message of messages) message.retry();
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "database_error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_-]{1,64}$/i.test(code) ? code : "database_error";
}

function safeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(["stage", "errorCode", "attempt", "permanent", "workerId", "eventType", "idlePollBackoffMs"]);
  return Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)));
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("worker_operation_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const worker = createCloudflarePaypalWebhookHandler();
export default worker;
