import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  isPaypalWebhookReady,
  PaypalApiError,
  PaypalClient,
  PaypalReadError,
  paypalConfigFromEnvironment,
} from "./paypal.js";
import { createAuditSupabase, type SupabasePort } from "./supabase.js";

const POLL_INTERVAL_MS = 1_000;
const RPC_TIMEOUT_MS = 5_000;
const MAX_EVENTS_PER_TICK = 25;

const claimedEventSchema = z.object({
  event_id: z.string().uuid(),
  provider_event_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(120),
  resource_id: z.string().min(1).max(255),
  payload: z.record(z.string(), z.unknown()),
  lease_token: z.string().uuid(),
  attempt_count: z.number().int().min(1).max(8),
});

type ClaimedEvent = z.infer<typeof claimedEventSchema>;
type WorkerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};
export interface PaypalWebhookWorkerOptions {
  rpcTimeoutMs?: number;
}

export class PaypalWebhookWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;
  private readonly workerId = randomUUID();

  constructor(
    private readonly serviceClient: Pick<SupabasePort, "rpc">,
    private readonly paypalClient: Pick<PaypalClient, "showInvoice">,
    private readonly logger: WorkerLogger,
    private readonly options: PaypalWebhookWorkerOptions = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  /** One durable queue pass; exported for deterministic local tests and health tooling. */
  async processAvailable(): Promise<void> {
    if (this.stopping) return;
    if (this.inFlight) return this.inFlight;
    const operation = this.processLoop().catch(() => {
      this.logger.warn({ workerId: this.workerId, stage: "worker_loop" }, "PayPal webhook worker stopped this pass after an unexpected failure");
    });
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = null;
    }
  }

  private wake(): void {
    void this.processAvailable();
  }

  private async processLoop(): Promise<void> {
    for (let count = 0; count < MAX_EVENTS_PER_TICK && !this.stopping; count += 1) {
      let claimResult: { data: unknown; error: unknown | null };
      try {
        claimResult = await this.withRpcTimeout(this.serviceClient.rpc("claim_paypal_webhook_event"));
      } catch {
        this.logger.warn({ workerId: this.workerId, stage: "claim", errorCode: "database_timeout" }, "PayPal webhook queue claim timed out");
        return;
      }
      if (claimResult.error) {
        this.logger.warn({ workerId: this.workerId, stage: "claim", errorCode: safeErrorCode(claimResult.error) }, "PayPal webhook queue claim failed");
        return;
      }
      if (claimResult.data === null) return;
      const parsed = claimedEventSchema.safeParse(claimResult.data);
      if (!parsed.success) {
        this.logger.warn({ workerId: this.workerId, stage: "claim_decode" }, "PayPal webhook queue returned an invalid job; its lease will expire for recovery");
        return;
      }
      await this.processClaim(parsed.data);
    }
  }

  private async processClaim(event: ClaimedEvent): Promise<void> {
    let providerInvoice;
    try {
      providerInvoice = await this.paypalClient.showInvoice(event.resource_id);
    } catch (cause) {
      if (cause instanceof PaypalApiError && cause.status === 404) {
        await this.completeNotFound(event);
        return;
      }
      const { code, permanent } = classifyFailure(cause);
      await this.fail(event, code, permanent);
      return;
    }
    if (providerInvoice.id !== event.resource_id) {
      await this.fail(event, "provider_invoice_mismatch", true);
      return;
    }

    let completed: { data: unknown; error: unknown | null };
    try {
      completed = await this.withRpcTimeout(this.serviceClient.rpc("complete_verified_paypal_webhook", {
        p_event_id: event.event_id,
        p_lease_token: event.lease_token,
        p_provider_invoice_id: providerInvoice.id,
        p_provider_status: providerInvoice.status,
        p_invoice_url: providerInvoice.invoiceUrl,
        p_paid_at: providerInvoice.paidAt,
        p_observed_at: new Date().toISOString(),
      }));
    } catch {
      await this.fail(event, "database_timeout", false);
      return;
    }
    if (completed.error) {
      await this.fail(event, "database_completion_failed", false);
      return;
    }
    this.logger.info({ workerId: this.workerId, eventType: event.event_type, stage: "completed" }, "Verified PayPal webhook event reconciled from the current provider invoice");
  }

  private async completeNotFound(event: ClaimedEvent): Promise<void> {
    try {
      const result = await this.withRpcTimeout(this.serviceClient.rpc("complete_verified_paypal_webhook", {
        p_event_id: event.event_id,
        p_lease_token: event.lease_token,
        p_provider_invoice_id: null,
        p_provider_status: null,
        p_invoice_url: null,
        p_paid_at: null,
        p_observed_at: null,
      }));
      if (result.error) await this.fail(event, "database_completion_failed", false);
      else this.logger.info({ workerId: this.workerId, eventType: event.event_type, stage: "unmatched" }, "Verified PayPal event refers to an invoice that is not available from the provider");
    } catch {
      await this.fail(event, "database_timeout", false);
    }
  }

  private async fail(event: ClaimedEvent, code: FailureCode, permanent: boolean): Promise<void> {
    try {
      const result = await this.withRpcTimeout(this.serviceClient.rpc("retry_paypal_webhook_event", {
        p_event_id: event.event_id,
        p_lease_token: event.lease_token,
        p_failure_code: code,
        p_permanent: permanent,
      }));
      if (result.error) {
        this.logger.warn({ workerId: this.workerId, eventType: event.event_type, attempt: event.attempt_count, stage: "retry_schedule", errorCode: safeErrorCode(result.error) }, "PayPal webhook retry could not be recorded; the event lease will expire for recovery");
        return;
      }
      this.logger.warn({ workerId: this.workerId, eventType: event.event_type, attempt: event.attempt_count, stage: "retry_scheduled", errorCode: code, permanent }, "PayPal webhook processing failed and was retained for retry or operator recovery");
    } catch {
      this.logger.warn({ workerId: this.workerId, eventType: event.event_type, attempt: event.attempt_count, stage: "retry_schedule", errorCode: "database_timeout" }, "PayPal webhook retry timed out; the event lease will expire for recovery");
    }
  }

  private withRpcTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("webhook_rpc_timeout")), this.options.rpcTimeoutMs ?? RPC_TIMEOUT_MS);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  }
}

type FailureCode =
  | "provider_read_failed"
  | "provider_http_400"
  | "provider_http_401"
  | "provider_http_403"
  | "provider_http_429"
  | "provider_http_5xx"
  | "provider_invoice_mismatch"
  | "database_completion_failed"
  | "database_timeout";

function classifyFailure(cause: unknown): { code: FailureCode; permanent: boolean } {
  if (cause instanceof PaypalApiError) {
    if (cause.status === 400) return { code: "provider_http_400", permanent: true };
    if (cause.status === 401) return { code: "provider_http_401", permanent: true };
    if (cause.status === 403) return { code: "provider_http_403", permanent: true };
    if (cause.status === 429) return { code: "provider_http_429", permanent: false };
    if (cause.status >= 500) return { code: "provider_http_5xx", permanent: false };
  }
  if (cause instanceof PaypalReadError) return { code: "provider_read_failed", permanent: false };
  return { code: "provider_read_failed", permanent: false };
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "unknown";
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : "unknown";
}

export function createPaypalWebhookWorkerFromEnvironment(logger: WorkerLogger): PaypalWebhookWorker | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const paypalConfig = paypalConfigFromEnvironment();
  if (!url || !serviceRoleKey || serviceRoleKey.startsWith("your-") || !paypalConfig || !isPaypalWebhookReady(paypalConfig)) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
    return new PaypalWebhookWorker(createAuditSupabase(url, serviceRoleKey), new PaypalClient(paypalConfig), logger);
  } catch {
    return null;
  }
}
