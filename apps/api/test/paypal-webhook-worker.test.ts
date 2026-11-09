import { describe, expect, it, vi } from "vitest";
import { PaypalApiError, PaypalReadError, type PaypalClient } from "../src/paypal.js";
import { createPaypalWebhookWorkerFromEnvironment, PaypalWebhookWorker, type PaypalWebhookWorkerOptions } from "../src/paypal-webhook-worker.js";
import type { SupabasePort } from "../src/supabase.js";

const eventId = "239f5928-38be-4805-918a-285d9122ab32";
const firstLease = "d4da3d57-ab38-4fd2-bb23-a1b27b4f49a7";
const secondLease = "33a01bdf-b346-4203-8756-994e411ab9ec";
const providerInvoiceId = "INV2-TEST-000001";

function claimedEvent(leaseToken = firstLease, attemptCount = 1) {
  return {
    event_id: eventId,
    provider_event_id: "WH-EVENT-1",
    event_type: "INVOICING.INVOICE.PAID",
    resource_id: providerInvoiceId,
    payload: { id: "WH-EVENT-1", event_type: "INVOICING.INVOICE.PAID", resource: { id: providerInvoiceId, status: "SENT" } },
    lease_token: leaseToken,
    attempt_count: attemptCount,
  };
}

function makeWorker(
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }>,
  showInvoice: (id: string) => Promise<{ id: string; status: string; invoiceUrl: string | null; paidAt: string | null; providerUpdatedAt?: string | null }>,
  options?: PaypalWebhookWorkerOptions,
) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const service = { rpc: vi.fn(rpc) };
  const paypal = { showInvoice: vi.fn(showInvoice) };
  const worker = new PaypalWebhookWorker(
    service as unknown as Pick<SupabasePort, "rpc">,
    paypal as unknown as Pick<PaypalClient, "showInvoice">,
    logger,
    options,
  );
  return { worker, service, paypal, logger };
}

describe("durable PayPal webhook worker", () => {
  it("logs worker readiness without writing configuration or event details", async () => {
    const { worker, logger } = makeWorker(async () => ({ data: null, error: null }), async (id) => ({
      id,
      status: "SENT",
      invoiceUrl: null,
      paidAt: null,
    }));

    worker.start();
    await worker.stop();

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ stage: "worker_started", idlePollBackoffMs: [1_000, 2_000, 4_000, 8_000, 15_000] }), expect.any(String));
    const output = JSON.stringify(logger.info.mock.calls);
    expect(output).not.toContain("PAYPAL_WEBHOOK_ID");
    expect(output).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("does not construct the worker when the real webhook ID is not configured", () => {
    vi.stubEnv("SUPABASE_URL", "https://proofpay-staging.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key");
    vi.stubEnv("PAYPAL_SANDBOX_CLIENT_ID", "mock-sandbox-client-id");
    vi.stubEnv("PAYPAL_SANDBOX_CLIENT_SECRET", "mock-sandbox-client-secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");

    try {
      const logger = { info: vi.fn(), warn: vi.fn() };
      expect(createPaypalWebhookWorkerFromEnvironment(logger)).toBeNull();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drains durable queued events on worker startup after a process restart", async () => {
    let durableQueue = [claimedEvent()];
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: durableQueue.shift() ?? null, error: null };
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    worker.start();
    await vi.waitFor(() => expect(paypal.showInvoice).toHaveBeenCalledTimes(1));
    await worker.stop();

    expect(service.rpc).toHaveBeenCalledWith("claim_paypal_webhook_event");
    expect(service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.any(Object));
    expect(durableQueue).toHaveLength(0);
  });

  it("allows Cron recovery to cap each pass to one durable event", async () => {
    let claims = 0;
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") {
        claims += 1;
        return { data: claims <= 2 ? claimedEvent() : null, error: null };
      }
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }), { maxEventsPerPass: 1 });

    const result = await worker.processAvailable();

    expect(result).toEqual({ processed: 1, batchLimitReached: true });
    expect(claims).toBe(1);
    expect(paypal.showInvoice).toHaveBeenCalledOnce();
    expect(service.rpc).toHaveBeenCalledTimes(2);
  });
  it("backs off idle polling by 1, 2, 4, 8, and 15 seconds, capped at 15 seconds", async () => {
    vi.useFakeTimers();
    const { worker, service } = makeWorker(async () => ({ data: null, error: null }), async (id) => ({
      id,
      status: "SENT",
      invoiceUrl: null,
      paidAt: null,
    }));
    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(service.rpc).toHaveBeenCalledTimes(1);

      let calls = 1;
      for (const interval of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
        await vi.advanceTimersByTimeAsync(interval - 1);
        expect(service.rpc).toHaveBeenCalledTimes(calls);
        await vi.advanceTimersByTimeAsync(1);
        calls += 1;
        expect(service.rpc).toHaveBeenCalledTimes(calls);
      }
    } finally {
      await worker.stop();
      vi.useRealTimers();
    }
  });

  it("recovers queued work after a missed notification on the next bounded idle poll", async () => {
    vi.useFakeTimers();
    let queued = false;
    let claimed = false;
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") {
        if (queued && !claimed) {
          claimed = true;
          return { data: claimedEvent(), error: null };
        }
        return { data: null, error: null };
      }
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));
    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(paypal.showInvoice).not.toHaveBeenCalled();

      // Simulate a durable enqueue whose in-process notification was lost.
      queued = true;
      await vi.advanceTimersByTimeAsync(14_999);
      expect(paypal.showInvoice).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
      expect(service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.any(Object));
    } finally {
      await worker.stop();
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent notifications and serializes their queue passes", async () => {
    let claimCount = 0;
    let releaseInitialClaim: (() => void) | undefined;
    const initialClaim = new Promise<{ data: null; error: null }>((resolve) => {
      releaseInitialClaim = () => resolve({ data: null, error: null });
    });
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name !== "claim_paypal_webhook_event") return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
      claimCount += 1;
      if (claimCount === 1) return initialClaim;
      return { data: claimCount === 2 ? claimedEvent() : null, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    const notifications = [worker.wake(), worker.wake(), worker.wake()];
    releaseInitialClaim?.();
    await Promise.all(notifications);

    expect(claimCount).toBe(3);
    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc.mock.calls.filter(([name]) => name === "complete_verified_paypal_webhook")).toHaveLength(1);
  });

  it("continues immediately after a full 25-event batch and does not serialize the next batch behind the idle delay", async () => {
    vi.useFakeTimers();
    let claimed = 0;
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") {
        claimed += 1;
        if (claimed <= 26) {
          const suffix = String(claimed).padStart(12, "0");
          return {
            data: {
              ...claimedEvent(),
              event_id: `00000000-0000-4000-8000-${suffix}`,
              provider_event_id: `WH-EVENT-${claimed}`,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));
    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(paypal.showInvoice).toHaveBeenCalledTimes(26);
      expect(claimed).toBe(27);
      expect(service.rpc.mock.calls.filter(([name]) => name === "complete_verified_paypal_webhook")).toHaveLength(26);
    } finally {
      await worker.stop();
      vi.useRealTimers();
    }
  });

  it("waits for in-flight work during shutdown and cancels the idle timer", async () => {
    let releaseClaim: ((value: { data: null; error: null }) => void) | undefined;
    let markClaimStarted: (() => void) | undefined;
    const claimStarted = new Promise<void>((resolve) => { markClaimStarted = resolve; });
    const pendingClaim = new Promise<{ data: null; error: null }>((resolve) => { releaseClaim = resolve; });
    const { worker, service } = makeWorker(async () => {
      markClaimStarted?.();
      return pendingClaim;
    }, async (id) => ({ id, status: "SENT", invoiceUrl: null, paidAt: null }));

    worker.start();
    await claimStarted;
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseClaim?.({ data: null, error: null });
    await stopping;
    const callsAtStop = service.rpc.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(stopped).toBe(true);
    expect(service.rpc).toHaveBeenCalledTimes(callsAtStop);
  });

  it("catches a rejected startup wake promise", async () => {
    const { worker, logger } = makeWorker(async () => ({ data: null, error: null }), async (id) => ({
      id,
      status: "SENT",
      invoiceUrl: null,
      paidAt: null,
    }));
    vi.spyOn(worker, "wake").mockRejectedValue(new Error("private diagnostic"));

    worker.start();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "worker_wake", errorCode: "wake_failed" }),
      expect.any(String),
    ));
    await worker.stop();

    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("private diagnostic");
  });

  it("reconciles a PAID provider snapshot instead of trusting stale event status", async () => {
    const names: string[] = [];
    const { worker, service, paypal } = makeWorker(async (name) => {
      names.push(name);
      if (name === "claim_paypal_webhook_event") return { data: names.filter((entry) => entry === name).length === 1 ? claimedEvent() : null, error: null };
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: "2026-11-02T12:00:00Z" }));

    await worker.processAvailable();

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(paypal.showInvoice).toHaveBeenCalledWith(providerInvoiceId);
    expect(names).toEqual(["claim_paypal_webhook_event", "complete_verified_paypal_webhook", "claim_paypal_webhook_event"]);
    expect(service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.objectContaining({
      p_provider_invoice_id: providerInvoiceId,
      p_provider_status: "PAID",
      p_paid_at: "2026-11-02T12:00:00Z",
      p_observed_at: expect.any(String),
      p_provider_updated_at: null,
    }));
    const completionArgs = vi.mocked(service.rpc).mock.calls.find(([name]) => name === "complete_verified_paypal_webhook")?.[1];
    expect(completionArgs).not.toHaveProperty("p_invoice_status");
  });

  it("prevents an older paid provider response from overwriting a newer refunded response", async () => {
    const olderEvent = {
      ...claimedEvent(),
      event_id: "00000000-0000-4000-8000-000000000101",
      provider_event_id: "WH-OLDER-PAID",
    };
    const newerEvent = {
      ...claimedEvent(secondLease),
      event_id: "00000000-0000-4000-8000-000000000102",
      provider_event_id: "WH-NEWER-REFUNDED",
    };
    const pendingEvents = [olderEvent, newerEvent];
    const invoiceState = {
      status: "sent" as string,
      providerUpdatedAt: null as string | null,
    };
    const rpc = async (name: string, args?: Record<string, unknown>) => {
      if (name === "claim_paypal_webhook_event") return { data: pendingEvents.shift() ?? null, error: null };
      if (name === "complete_verified_paypal_webhook") {
        const incomingVersion = typeof args?.p_provider_updated_at === "string" ? args.p_provider_updated_at : null;
        const incomingStatus = args?.p_provider_status === "REFUNDED" ? "refunded" : "paid";
        const versionIsCurrent = incomingVersion !== null
          ? invoiceState.providerUpdatedAt === null || incomingVersion >= invoiceState.providerUpdatedAt
          : invoiceState.providerUpdatedAt === null;
        const transitionIsAllowed = invoiceState.status !== "refunded" || incomingStatus === "refunded";
        const applied = versionIsCurrent && transitionIsAllowed;
        if (applied) {
          invoiceState.status = incomingStatus;
          invoiceState.providerUpdatedAt = incomingVersion;
        }
        return { data: { duplicate: false, matched: true, applied, status: invoiceState.status }, error: null };
      }
      return { data: null, error: null };
    };

    let releaseOldRead: ((snapshot: { id: string; status: string; invoiceUrl: null; paidAt: string | null; providerUpdatedAt: string }) => void) | undefined;
    let signalOldReadStarted: (() => void) | undefined;
    const oldReadStarted = new Promise<void>((resolve) => { signalOldReadStarted = resolve; });
    const oldProviderRead = new Promise<{ id: string; status: string; invoiceUrl: null; paidAt: string | null; providerUpdatedAt: string }>((resolve) => {
      releaseOldRead = resolve;
    });
    const olderWorker = makeWorker(rpc, async () => {
      signalOldReadStarted?.();
      return oldProviderRead;
    });
    const olderPass = olderWorker.worker.processAvailable();
    await oldReadStarted;

    const newerWorker = makeWorker(rpc, async (id) => ({
      id,
      status: "REFUNDED",
      invoiceUrl: null,
      paidAt: null,
      providerUpdatedAt: "2026-11-07T12:00:00.000Z",
    }));
    await newerWorker.worker.processAvailable();
    releaseOldRead?.({
      id: providerInvoiceId,
      status: "PAID",
      invoiceUrl: null,
      paidAt: "2026-11-07T11:00:00.000Z",
      providerUpdatedAt: "2026-11-07T11:00:00.000Z",
    });
    await olderPass;

    expect(invoiceState).toEqual({
      status: "refunded",
      providerUpdatedAt: "2026-11-07T12:00:00.000Z",
    });
    expect(olderWorker.service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.objectContaining({
      p_provider_status: "PAID",
      p_provider_updated_at: "2026-11-07T11:00:00.000Z",
      p_observed_at: expect.any(String),
    }));
    expect(olderWorker.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "snapshot_not_applied" }),
      expect.any(String),
    );
  });

  it("does not start concurrent duplicate worker passes in the same process", async () => {
    let claimed = false;
    let releaseProviderRead: (() => void) | undefined;
    const providerRead = new Promise<{ id: string; status: string; invoiceUrl: null; paidAt: null }>((resolve) => {
      releaseProviderRead = () => resolve({ id: providerInvoiceId, status: "PAID", invoiceUrl: null, paidAt: null });
    });
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async () => providerRead);

    const firstPass = worker.processAvailable();
    const duplicatePass = worker.processAvailable();
    releaseProviderRead?.();
    await Promise.all([firstPass, duplicatePass]);

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledTimes(3);
  });

  it("can wake immediately after a durable enqueue notification", async () => {
    let claimed = false;
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    await worker.wake();

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.any(Object));
  });

  it("rechecks the queue when an enqueue notification arrives during an empty claim", async () => {
    let claimCount = 0;
    let releaseInitialClaim: (() => void) | undefined;
    const initialClaim = new Promise<{ data: null; error: null }>((resolve) => {
      releaseInitialClaim = () => resolve({ data: null, error: null });
    });
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name !== "claim_paypal_webhook_event") return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
      claimCount += 1;
      if (claimCount === 1) return initialClaim;
      return { data: claimCount === 2 ? claimedEvent() : null, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    const initialPass = worker.processAvailable();
    const notifiedPass = worker.wake();
    releaseInitialClaim?.();
    await Promise.all([initialPass, notifiedPass]);

    expect(claimCount).toBe(3);
    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.any(Object));
  });

  it("uses durable claims to prevent separate worker instances processing one event concurrently", async () => {
    let claimed = false;
    let releaseProviderRead: (() => void) | undefined;
    const providerRead = new Promise<{ id: string; status: string; invoiceUrl: null; paidAt: null }>((resolve) => {
      releaseProviderRead = () => resolve({ id: providerInvoiceId, status: "PAID", invoiceUrl: null, paidAt: null });
    });
    const sharedQueueRpc = async (name: string) => {
      if (name === "claim_paypal_webhook_event") {
        if (claimed) return { data: null, error: null };
        claimed = true;
        return { data: claimedEvent(), error: null };
      }
      return { data: { duplicate: false, matched: true, applied: true, status: "paid" }, error: null };
    };
    const first = makeWorker(sharedQueueRpc, async () => providerRead);
    const second = makeWorker(sharedQueueRpc, async () => providerRead);

    const processing = Promise.all([first.worker.processAvailable(), second.worker.processAvailable()]);
    releaseProviderRead?.();
    await processing;

    const showInvoiceCalls = first.paypal.showInvoice.mock.calls.length + second.paypal.showInvoice.mock.calls.length;
    const completionCalls = [...first.service.rpc.mock.calls, ...second.service.rpc.mock.calls]
      .filter(([name]) => name === "complete_verified_paypal_webhook");
    expect(showInvoiceCalls).toBe(1);
    expect(completionCalls).toHaveLength(1);
  });

  it("schedules transient provider failures without retrying inline", async () => {
    let claimCount = 0;
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimCount++ === 0 ? claimedEvent() : null, error: null };
      return { data: { status: "retry_scheduled" }, error: null };
    }, async () => { throw new PaypalApiError(503, "provider unavailable"); });

    await worker.processAvailable();

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("retry_paypal_webhook_event", {
      p_event_id: eventId,
      p_lease_token: firstLease,
      p_failure_code: "provider_http_5xx",
      p_permanent: false,
    });
  });

  it("retains provider timeouts for retry instead of dropping the event", async () => {
    let claimed = false;
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { status: "retry_scheduled" }, error: null };
    }, async () => { throw new PaypalReadError(); });

    await worker.processAvailable();

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("retry_paypal_webhook_event", expect.objectContaining({
      p_failure_code: "provider_read_failed",
      p_permanent: false,
    }));
  });

  it("bounds a stalled durable queue claim and leaves the event recoverable", async () => {
    const { worker, service, logger } = makeWorker(
      () => new Promise(() => undefined),
      async (id) => ({ id, status: "SENT", invoiceUrl: null, paidAt: null }),
      { rpcTimeoutMs: 5 },
    );

    await worker.processAvailable();

    expect(service.rpc).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: "claim", errorCode: "database_timeout" }), expect.any(String));
  });

  it("dead-letters permanent provider authorization failures", async () => {
    let claimed = false;
    const { worker, service, paypal, logger } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { status: "dead_lettered" }, error: null };
    }, async () => { throw new PaypalApiError(403, "credentials rejected"); });

    await worker.processAvailable();

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("retry_paypal_webhook_event", expect.objectContaining({
      p_failure_code: "provider_http_403",
      p_permanent: true,
    }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: "dead_lettered", errorCode: "provider_http_403" }), expect.any(String));
  });

  it("does not report a retry outcome when the retry receipt is malformed", async () => {
    let claimed = false;
    const { worker, logger } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { status: "unknown" }, error: null };
    }, async () => { throw new PaypalApiError(503, "provider unavailable"); });

    await worker.processAvailable();

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: "retry_schedule", errorCode: "invalid_retry_receipt" }), expect.any(String));
    expect(logger.warn.mock.calls.some(([fields]) => (fields as Record<string, unknown>).stage === "retry_scheduled" || (fields as Record<string, unknown>).stage === "dead_lettered")).toBe(false);
  });

  it("marks an authoritative provider 404 as unmatched without changing an invoice", async () => {
    let claimed = false;
    const { worker, service } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { duplicate: false, matched: false, status: "provider_invoice_not_found" }, error: null };
    }, async () => { throw new PaypalApiError(404, "not found"); });

    await worker.processAvailable();

    expect(service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", {
      p_event_id: eventId,
      p_lease_token: firstLease,
      p_provider_invoice_id: null,
      p_provider_status: null,
      p_invoice_url: null,
      p_paid_at: null,
      p_observed_at: null,
      p_provider_updated_at: null,
    });
    expect(service.rpc).not.toHaveBeenCalledWith("retry_paypal_webhook_event", expect.anything());
  });

  it("does not report reconciliation when a provider invoice has no local match", async () => {
    let claimed = false;
    const { worker, logger } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { duplicate: false, matched: false, applied: false, invoiceId: null, status: null }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    await worker.processAvailable();

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: "unmatched", errorCode: "invoice_not_linked_locally" }), expect.any(String));
    expect(logger.info.mock.calls.some(([fields]) => (fields as Record<string, unknown>).stage === "completed")).toBe(false);
  });

  it("reports a stale provider snapshot without claiming it changed the local invoice", async () => {
    let claimed = false;
    const { worker, logger } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: {
        duplicate: false,
        matched: true,
        applied: false,
        snapshotApplied: false,
        snapshotRejectionReason: "stale_provider_version",
        status: "paid",
      }, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    await worker.processAvailable();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "snapshot_not_applied", errorCode: "stale_provider_version" }),
      expect.any(String),
    );
    expect(logger.info.mock.calls.some(([fields]) => (fields as Record<string, unknown>).stage === "completed")).toBe(false);
  });

  it("does not report successful reconciliation when the completion receipt is malformed", async () => {
    let claimed = false;
    const { worker, logger } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: {}, error: null };
    }, async (id) => ({ id, status: "PAID", invoiceUrl: null, paidAt: null }));

    await worker.processAvailable();

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: "completion_receipt", errorCode: "invalid_completion_receipt" }), expect.any(String));
    expect(logger.info.mock.calls.some(([fields]) => (fields as Record<string, unknown>).stage === "completed")).toBe(false);
  });

  it("records a completion failure for retry, then a new worker can recover the leased event", async () => {
    let claims = 0;
    const failedService = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claims++ === 0 ? claimedEvent() : null, error: null };
      if (name === "complete_verified_paypal_webhook") return { data: null, error: { code: "08006" } };
      return { data: { status: "retry_scheduled" }, error: null };
    }, async (id) => ({ id, status: "SENT", invoiceUrl: null, paidAt: null }));
    await failedService.worker.processAvailable();
    expect(failedService.service.rpc).toHaveBeenCalledWith("retry_paypal_webhook_event", expect.objectContaining({
      p_failure_code: "database_completion_failed",
      p_permanent: false,
    }));

    let restartClaims = 0;
    const restarted = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: restartClaims++ === 0 ? claimedEvent(secondLease, 2) : null, error: null };
      return { data: { duplicate: false, matched: true, applied: true, status: "sent" }, error: null };
    }, async (id) => ({ id, status: "SENT", invoiceUrl: null, paidAt: null }));
    await restarted.worker.processAvailable();

    expect(restarted.paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(restarted.paypal.showInvoice).toHaveBeenCalledWith(providerInvoiceId);
    expect(restarted.service.rpc).toHaveBeenCalledWith("complete_verified_paypal_webhook", expect.objectContaining({ p_lease_token: secondLease }));
  });

  it("does not log the payload, recipient data, or provider response body", async () => {
    let claimed = false;
    const { worker, logger } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, { ...claimedEvent(), payload: { recipient: "release-test-user-008@example.invalid" } }), error: null };
      return { data: { duplicate: false, matched: true, applied: true, status: "sent" }, error: null };
    }, async (id) => ({ id, status: "SENT", invoiceUrl: null, paidAt: null }));

    await worker.processAvailable();
    const output = JSON.stringify({ info: logger.info.mock.calls, warn: logger.warn.mock.calls });
    expect(output).not.toContain("release-test-user-008@example.invalid");
    expect(output).not.toContain("WH-EVENT-1");
  });
});
