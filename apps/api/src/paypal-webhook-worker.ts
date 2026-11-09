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

const IDLE_POLL_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
const IMMEDIATE_BATCH_CONTINUATION_MS = 0;
const RPC_TIMEOUT_MS = 5_000;
const MAX_EVENTS_PER_TICK = 25;
const EMPTY_PASS: QueuePassResult = { processed: 0, batchLimitReached: false };

const claimedEventSchema = z.object({
  event_id: z.string().uuid(),
  provider_event_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(120),
  resource_id: z.string().min(1).max(255),
  payload: z.record(z.string(), z.unknown()),
  lease_token: z.string().uuid(),
  attempt_count: z.number().int().min(1).max(8),
});
const retryReceiptSchema = z.object({
  status: z.enum(["retry_scheduled", "dead_lettered", "processed"]),
}).passthrough();
const completionReceiptSchema = z.object({
  duplicate: z.boolean(),
  matched: z.boolean(),
  applied: z.boolean().optional(),
  snapshotApplied: z.boolean().optional(),
  snapshotRejectionReason: z.string().max(80).nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

type ClaimedEvent = z.infer<typeof claimedEventSchema>;
type QueuePassResult = { processed: number; batchLimitReached: boolean };
type WorkerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};
export interface PaypalWebhookWorkerOptions {
  rpcTimeoutMs?: number;
  maxEventsPerPass?: number;
}

export class PaypalWebhookWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<QueuePassResult> | null = null;
  private wakeTask: Promise<void> | null = null;
  private wakeRequested = false;
  private idleBackoffIndex = 0;
  private started = false;
  private stopping = false;
  private readonly workerId = randomUUID();

  constructor(
    private readonly serviceClient: Pick<SupabasePort, "rpc">,
    private readonly paypalClient: Pick<PaypalClient, "showInvoice">,
    private readonly logger: WorkerLogger,
    private readonly options: PaypalWebhookWorkerOptions = {},
  ) {}

  start(): void {
    if (this.started) return;
    this.stopping = false;
    this.started = true;
    this.logger.info({ workerId: this.workerId, stage: "worker_started", idlePollBackoffMs: IDLE_POLL_BACKOFF_MS }, "PayPal webhook queue worker started");
    this.triggerWakeSafely();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.wakeRequested = false;
    this.clearScheduledPoll();
    await Promise.all([
      this.wakeTask?.catch(() => undefined),
      this.inFlight?.then(() => undefined, () => undefined),
    ]);
  }

  /** One durable queue pass; exported for deterministic local tests and health tooling. */
  async processAvailable(): Promise<QueuePassResult> {
    if (this.stopping) return EMPTY_PASS;
    if (this.inFlight) return this.inFlight;
    const operation = this.processLoop().catch(() => {
      this.safeWarn({ workerId: this.workerId, stage: "worker_loop" }, "PayPal webhook worker stopped this pass after an unexpected failure");
      return EMPTY_PASS;
    });
    this.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = null;
    }
  }

  /** Run an immediate queue pass, for startup, polling, or a durable-enqueue notification. */
  async wake(): Promise<void> {
    if (this.stopping) return;
    this.clearScheduledPoll();
    this.wakeRequested = true;
    if (this.wakeTask) return this.wakeTask;

    const operation = this.drainWakeRequests();
    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (this.wakeTask === tracked) this.wakeTask = null;
      if (this.wakeRequested && !this.stopping) this.triggerWakeSafely();
    });
    this.wakeTask = tracked;
    return tracked;
  }

  private async drainWakeRequests(): Promise<void> {
    let pass = EMPTY_PASS;
    while (this.wakeRequested && !this.stopping) {
      this.wakeRequested = false;
      const passWasAlreadyRunning = this.inFlight !== null;
      pass = await this.processAvailable();

      // A notification that overlaps an empty claim must get a fresh claim pass.
      if (passWasAlreadyRunning && !this.stopping) this.wakeRequested = true;
      if (this.stopping) return;

      // Keep each batch bounded while scheduling the next batch immediately.
      if (pass.batchLimitReached) {
        this.idleBackoffIndex = 0;
        this.schedulePoll(IMMEDIATE_BATCH_CONTINUATION_MS);
        return;
      }
    }

    if (!this.stopping) this.scheduleNextPoll(pass);
  }

  private async processLoop(): Promise<QueuePassResult> {
    let processed = 0;
    const configuredLimit = this.options.maxEventsPerPass;
    const eventLimit = configuredLimit !== undefined && Number.isInteger(configuredLimit) && configuredLimit > 0
      ? Math.min(configuredLimit, MAX_EVENTS_PER_TICK)
      : MAX_EVENTS_PER_TICK;
    for (let count = 0; count < eventLimit && !this.stopping; count += 1) {
      let claimResult: { data: unknown; error: unknown | null };
      try {
        claimResult = await this.withRpcTimeout(this.serviceClient.rpc("claim_paypal_webhook_event"));
      } catch {
        this.safeWarn({ workerId: this.workerId, stage: "claim", errorCode: "database_timeout" }, "PayPal webhook queue claim timed out");
        return { processed, batchLimitReached: false };
      }
      if (claimResult.error) {
        this.safeWarn({ workerId: this.workerId, stage: "claim", errorCode: safeErrorCode(claimResult.error) }, "PayPal webhook queue claim failed");
        return { processed, batchLimitReached: false };
      }
      if (claimResult.data === null) return { processed, batchLimitReached: false };
      const parsed = claimedEventSchema.safeParse(claimResult.data);
      if (!parsed.success) {
        this.safeWarn({ workerId: this.workerId, stage: "claim_decode" }, "PayPal webhook queue returned an invalid job; its lease will expire for recovery");
        return { processed, batchLimitReached: false };
      }
      processed += 1;
      await this.processClaim(parsed.data);
    }
    return { processed, batchLimitReached: processed === eventLimit };
  }

  private scheduleNextPoll(pass: QueuePassResult): void {
    if (!this.started || this.stopping) return;
    let delayMs: number;
    if (pass.processed > 0) {
      this.idleBackoffIndex = 0;
      delayMs = IDLE_POLL_BACKOFF_MS[0];
      this.idleBackoffIndex = 1;
    } else {
      delayMs = IDLE_POLL_BACKOFF_MS[this.idleBackoffIndex] ?? IDLE_POLL_BACKOFF_MS.at(-1)!;
      this.idleBackoffIndex = Math.min(this.idleBackoffIndex + 1, IDLE_POLL_BACKOFF_MS.length - 1);
    }
    this.schedulePoll(delayMs);
  }

  private schedulePoll(delayMs: number): void {
    if (!this.started || this.stopping) return;
    this.clearScheduledPoll();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.triggerWakeSafely();
    }, delayMs);
    this.timer.unref();
  }

  private clearScheduledPoll(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private triggerWakeSafely(): void {
    try {
      void this.wake().catch(() => {
        this.safeWarn({ workerId: this.workerId, stage: "worker_wake", errorCode: "wake_failed" }, "PayPal webhook worker wake failed; queued work remains available for a later poll");
      });
    } catch {
      this.safeWarn({ workerId: this.workerId, stage: "worker_wake", errorCode: "wake_failed" }, "PayPal webhook worker wake failed; queued work remains available for a later poll");
    }
  }

  private safeWarn(fields: Record<string, unknown>, message: string): void {
    try {
      this.logger.warn(fields, message);
    } catch {
      // Logging failure must not break durable queue acknowledgement or shutdown.
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
        p_provider_updated_at: providerInvoice.providerUpdatedAt ?? null,
      }));
    } catch {
      await this.fail(event, "database_timeout", false);
      return;
    }
    if (completed.error) {
      await this.fail(event, "database_completion_failed", false);
      return;
    }
    const receipt = completionReceiptSchema.safeParse(completed.data);
    if (!receipt.success || (!receipt.data.duplicate && receipt.data.matched && typeof receipt.data.applied !== "boolean")) {
      this.logger.warn({ workerId: this.workerId, eventType: event.event_type, stage: "completion_receipt", errorCode: "invalid_completion_receipt" }, "PayPal webhook completion outcome could not be confirmed; inspect the durable event state before recovery");
      return;
    }
    if (receipt.data.duplicate) {
      this.logger.info({ workerId: this.workerId, eventType: event.event_type, stage: "already_processed" }, "PayPal webhook event was already completed by another worker");
      return;
    }
    if (!receipt.data.matched) {
      const errorCode = receipt.data.status === "provider_invoice_not_found" ? "provider_invoice_not_found" : "invoice_not_linked_locally";
      this.logger.warn({ workerId: this.workerId, eventType: event.event_type, stage: "unmatched", errorCode }, "Verified PayPal event was stored as processed but did not match a local invoice");
      return;
    }
    if (!receipt.data.applied) {
      this.logger.info({
        workerId: this.workerId,
        eventType: event.event_type,
        stage: "snapshot_not_applied",
        errorCode: receipt.data.snapshotRejectionReason ?? "snapshot_not_current",
      }, "The verified provider snapshot was not applied; the existing invoice state was preserved");
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
        p_provider_updated_at: null,
      }));
      if (result.error) await this.fail(event, "database_completion_failed", false);
      else {
        const receipt = completionReceiptSchema.safeParse(result.data);
        if (receipt.success && receipt.data.duplicate) {
          this.logger.info({ workerId: this.workerId, eventType: event.event_type, stage: "already_processed" }, "PayPal webhook event was already completed by another worker");
        } else if (receipt.success && !receipt.data.matched && receipt.data.status === "provider_invoice_not_found") {
          this.logger.warn({ workerId: this.workerId, eventType: event.event_type, stage: "unmatched", errorCode: "provider_invoice_not_found" }, "Verified PayPal event refers to an invoice that is not available from the provider");
        } else {
          this.logger.warn({ workerId: this.workerId, eventType: event.event_type, stage: "completion_receipt", errorCode: "invalid_completion_receipt" }, "PayPal unmatched-event completion outcome could not be confirmed; inspect the durable event state before recovery");
        }
      }
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
      const receipt = retryReceiptSchema.safeParse(result.data);
      if (!receipt.success) {
        this.logger.warn({ workerId: this.workerId, eventType: event.event_type, attempt: event.attempt_count, stage: "retry_schedule", errorCode: "invalid_retry_receipt" }, "PayPal webhook retry outcome could not be confirmed; the event lease will expire for recovery");
        return;
      }
      if (receipt.data.status === "processed") {
        this.logger.info({ workerId: this.workerId, eventType: event.event_type, attempt: event.attempt_count, stage: "already_processed" }, "PayPal webhook event was already processed before its retry could be recorded");
        return;
      }
      this.logger.warn({
        workerId: this.workerId,
        eventType: event.event_type,
        attempt: event.attempt_count,
        stage: receipt.data.status,
        errorCode: code,
        permanent,
      }, receipt.data.status === "dead_lettered"
        ? "PayPal webhook event was retained as a dead letter for operator recovery"
        : "PayPal webhook processing failed and was retained for retry");
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
