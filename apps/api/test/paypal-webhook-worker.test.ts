import { describe, expect, it, vi } from "vitest";
import { PaypalApiError, PaypalReadError, type PaypalClient } from "../src/paypal.js";
import { PaypalWebhookWorker, type PaypalWebhookWorkerOptions } from "../src/paypal-webhook-worker.js";
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
  showInvoice: (id: string) => Promise<{ id: string; status: string; invoiceUrl: string | null; paidAt: string | null }>,
  options?: PaypalWebhookWorkerOptions,
) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const service = { rpc: vi.fn(rpc) } as unknown as Pick<SupabasePort, "rpc">;
  const paypal = { showInvoice: vi.fn(showInvoice) } as unknown as Pick<PaypalClient, "showInvoice">;
  return { worker: new PaypalWebhookWorker(service, paypal, logger, options), service, paypal, logger };
}

describe("durable PayPal webhook worker", () => {
  it("reconciles a PAID provider snapshot instead of trusting stale event status", async () => {
    const names: string[] = [];
    const { worker, service, paypal } = makeWorker(async (name) => {
      names.push(name);
      if (name === "claim_paypal_webhook_event") return { data: names.filter((entry) => entry === name).length === 1 ? claimedEvent() : null, error: null };
      return { data: { matched: true, applied: true, status: "paid" }, error: null };
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
    }));
    const completionArgs = vi.mocked(service.rpc).mock.calls.find(([name]) => name === "complete_verified_paypal_webhook")?.[1];
    expect(completionArgs).not.toHaveProperty("p_invoice_status");
  });

  it("does not start concurrent duplicate worker passes in the same process", async () => {
    let claimed = false;
    let releaseProviderRead: (() => void) | undefined;
    const providerRead = new Promise<{ id: string; status: string; invoiceUrl: null; paidAt: null }>((resolve) => {
      releaseProviderRead = () => resolve({ id: providerInvoiceId, status: "PAID", invoiceUrl: null, paidAt: null });
    });
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { matched: true, applied: true }, error: null };
    }, async () => providerRead);

    const firstPass = worker.processAvailable();
    const duplicatePass = worker.processAvailable();
    releaseProviderRead?.();
    await Promise.all([firstPass, duplicatePass]);

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledTimes(3);
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
    const { worker, service, paypal } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { status: "dead_lettered" }, error: null };
    }, async () => { throw new PaypalApiError(403, "credentials rejected"); });

    await worker.processAvailable();

    expect(paypal.showInvoice).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith("retry_paypal_webhook_event", expect.objectContaining({
      p_failure_code: "provider_http_403",
      p_permanent: true,
    }));
  });

  it("marks an authoritative provider 404 as unmatched without changing an invoice", async () => {
    let claimed = false;
    const { worker, service } = makeWorker(async (name) => {
      if (name === "claim_paypal_webhook_event") return { data: claimed ? null : (claimed = true, claimedEvent()), error: null };
      return { data: { matched: false, status: "provider_invoice_not_found" }, error: null };
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
    });
    expect(service.rpc).not.toHaveBeenCalledWith("retry_paypal_webhook_event", expect.anything());
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
      return { data: { matched: true, applied: true, status: "sent" }, error: null };
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
      return { data: { matched: true }, error: null };
    }, async (id) => ({ id, status: "SENT", invoiceUrl: null, paidAt: null }));

    await worker.processAvailable();
    const output = JSON.stringify({ info: logger.info.mock.calls, warn: logger.warn.mock.calls });
    expect(output).not.toContain("release-test-user-008@example.invalid");
    expect(output).not.toContain("WH-EVENT-1");
  });
});
