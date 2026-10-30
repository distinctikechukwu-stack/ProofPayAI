import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  mapPaypalStatus,
  normalizePaypalError,
  PaypalApiError,
  PaypalClient,
  PaypalWriteUnknownError,
} from "../src/paypal.js";
import type { SupabasePort } from "../src/supabase.js";

const actorId = "802b3f51-3452-4b56-86c4-cb1e3c348eef";
const milestoneId = "dd40c28b-9d8f-4ca7-890a-b803a8e54fdd";
const invoiceId = "317d05be-99af-4304-a26b-124a80d2257f";
const claimId = "4dca07f0-138c-4505-bd0d-79f2f238e67b";
const invoiceNumber = "PP-abc123xyz";
const invoiceUrl = "https://www.sandbox.paypal.com/invoice/p/#example";

const claimedInvoice = {
  id: invoiceId,
  project_id: "18982f2f-fc76-4c81-a1f3-4960f930a412",
  milestone_id: milestoneId,
  provider_invoice_id: null,
  provider_invoice_number: invoiceNumber,
  invoice_url: null,
  status: "create_pending",
  provider_status: null,
  amount_minor: "15000",
  currency: "USD",
  due_date: null,
  paid_at: null,
  created_at: "2026-10-29T12:00:00Z",
  updated_at: "2026-10-29T12:00:00Z",
};

const persistedDraft = {
  ...claimedInvoice,
  provider_invoice_id: "PAYPAL-INV-1",
  invoice_url: invoiceUrl,
  status: "draft",
  provider_status: "DRAFT",
};
const pendingSendInvoice = { ...persistedDraft, status: "send_pending" };
const persistedSent = { ...persistedDraft, status: "sent", provider_status: "SENT" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function providerInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "PAYPAL-INV-1",
    status: "DRAFT",
    detail: { invoice_number: invoiceNumber },
    links: [{ rel: "payer-view", href: invoiceUrl }],
    ...overrides,
  };
}

function clientFetch(handler: (url: string, init: RequestInit | undefined) => Promise<Response>): typeof fetch {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
}

function appFixture(args: {
  fetch: typeof fetch;
  serviceRpc?: (name: string, values?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }>;
}) {
  const requestClient = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: actorId } }, error: null })) },
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(async () => ({ data: [], error: null })),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      };
      return query;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as SupabasePort;
  const serviceRpc = vi.fn(args.serviceRpc ?? (async () => ({ data: null, error: null })));
  const serviceClient = { ...requestClient, rpc: serviceRpc } as unknown as SupabasePort;
  const appPromise = buildApp({
    logger: false,
    supabaseUrl: "https://proofpay.supabase.co",
    supabaseAnonKey: "public-anon-key",
    createSupabaseClient: () => requestClient,
    createAuditSupabaseClient: () => serviceClient,
    paypal: { clientId: "sandbox-client-id", clientSecret: "sandbox-client-secret", webhookId: "sandbox-webhook-id", fetch: args.fetch },
  });
  return { appPromise, serviceRpc };
}

describe("PayPal Sandbox REST boundary", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("uses Sandbox OAuth and sends exact decimal invoice fields without returning credentials", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch = clientFetch(async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "sandbox-access-token", expires_in: 3600 });
      return jsonResponse(providerInvoice(), 201);
    });
    const client = new PaypalClient({ clientId: "sandbox-client-id", clientSecret: "sandbox-client-secret", webhookId: "sandbox-webhook-id", fetch });

    const result = await client.createInvoice({
      invoiceNumber,
      currency: "USD",
      invoiceDate: "2026-10-29",
      clientEmail: "client@example.test",
      milestoneTitle: "Discovery milestone",
      amountDecimal: "150.00",
    });

    expect(result).toMatchObject({ id: "PAYPAL-INV-1", status: "DRAFT", invoiceNumber, invoiceUrl });
    expect(requests[0]?.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("sandbox-client-id:sandbox-client-secret").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(requests[0]?.init?.body).toBe("grant_type=client_credentials");
    expect(requests[1]?.url).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices");
    expect(requests[1]?.init?.headers).toMatchObject({ Authorization: "Bearer sandbox-access-token" });
    const body = JSON.parse(String(requests[1]?.init?.body));
    expect(body).toMatchObject({
      detail: { currency_code: "USD", invoice_number: invoiceNumber, invoice_date: "2026-10-29" },
      primary_recipients: [{ billing_info: { email_address: "client@example.test" } }],
      items: [{ name: "Discovery milestone", quantity: "1", unit_amount: { currency_code: "USD", value: "150.00" } }],
    });
    expect(JSON.stringify(result)).not.toContain("sandbox-access-token");
    expect(JSON.stringify(result)).not.toContain("sandbox-client-secret");
  });

  it("searches every result page and matches the exact persisted invoice number", async () => {
    const urls: string[] = [];
    const fetch = clientFetch(async (url) => {
      urls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.includes("page=1")) return jsonResponse({ items: [providerInvoice({ detail: { invoice_number: "OTHER" } })], total_pages: 2 });
      return jsonResponse({ items: [providerInvoice()], total_pages: 2 });
    });
    const matches = await new PaypalClient({ clientId: "id", clientSecret: "secret", fetch }).findInvoices(invoiceNumber);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.invoiceNumber).toBe(invoiceNumber);
    expect(urls.filter((url) => url.includes("/search-invoices"))).toEqual([
      "https://api-m.sandbox.paypal.com/v2/invoicing/search-invoices?page=1&page_size=100&total_required=true",
      "https://api-m.sandbox.paypal.com/v2/invoicing/search-invoices?page=2&page_size=100&total_required=true",
    ]);
  });

  it("marks a create connection loss as unknown rather than failed", async () => {
    let calls = 0;
    const fetch = clientFetch(async (url) => {
      calls += 1;
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      throw new TypeError("socket closed");
    });
    const client = new PaypalClient({ clientId: "id", clientSecret: "secret", fetch });

    await expect(client.createInvoice({
      invoiceNumber, currency: "USD", invoiceDate: "2026-10-29", clientEmail: "client@example.test",
      milestoneTitle: "Discovery", amountDecimal: "150.00",
    })).rejects.toBeInstanceOf(PaypalWriteUnknownError);
    expect(calls).toBe(2);
  });

  it("keeps an unfamiliar provider state unknown and leaves its operation available for reconciliation", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? jsonResponse({ access_token: "token", expires_in: 3600 })
      : jsonResponse(providerInvoice({ status: "FUTURE_PROVIDER_STATE" }), 201));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "client@example.test", milestoneTitle: "Discovery",
        }, error: null };
        if (name === "finalize_paypal_operation") return { data: { invoice: { ...claimedInvoice, status: "unknown", provider_status: "FUTURE_PROVIDER_STATE" }, claimState: values?.p_outcome }, error: null };
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ outcome: "unknown", invoice: { status: "unknown", providerStatus: "FUTURE_PROVIDER_STATE" } });
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "unknown", p_provider_status: "FUTURE_PROVIDER_STATE" }));
  });

  it("does not mark an invoice paid from the create action response", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? jsonResponse({ access_token: "token", expires_in: 3600 })
      : jsonResponse(providerInvoice({ status: "PAID" }), 201));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "client@example.test", milestoneTitle: "Discovery",
        }, error: null };
        if (name === "finalize_paypal_operation") return { data: { invoice: { ...claimedInvoice, status: "unknown" }, claimState: values?.p_outcome }, error: null };
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ outcome: "unknown", invoice: { status: "unknown" } });
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "unknown", p_invoice_status: null }));
  });

  it("maps provider states without treating partial payment as paid", () => {
    expect(mapPaypalStatus("PARTIALLY_PAID")).toBe("partially_paid");
    expect(mapPaypalStatus("PAYMENT_PENDING")).toBe("payment_pending");
    expect(mapPaypalStatus("PAID")).toBe("paid");
    expect(mapPaypalStatus("MARKED_AS_PAID")).toBe("paid_external");
    expect(mapPaypalStatus("PAID_EXTERNAL")).toBe("paid_external");
    expect(mapPaypalStatus("REFUNDED")).toBe("refunded");
    expect(mapPaypalStatus("REFUNDED_EXTERNAL")).toBe("refunded_external");
    expect(mapPaypalStatus("NEW_PROVIDER_STATE")).toBe("unknown");
  });

  it("maps credentials, quota, and caller errors without exposing provider debug IDs", () => {
    expect(normalizePaypalError(new PaypalApiError(401, "private provider message", "debug-1"))).toEqual({
      status: 502, message: "PayPal Sandbox credentials or invoice permissions need attention.",
    });
    expect(normalizePaypalError(new PaypalApiError(429, "private provider message", "debug-2"))).toMatchObject({ status: 503 });
    expect(normalizePaypalError(new PaypalApiError(422, "Invalid invoice email", "debug-3"))).toEqual({ status: 422, message: "Invalid invoice email" });
  });

  it("commits an authorized create claim before contacting PayPal and returns only safe persisted fields", async () => {
    const events: string[] = [];
    const fetch = clientFetch(async (url, init) => {
      events.push(`provider:${url}`);
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "sandbox-access-token", expires_in: 3600 });
      return jsonResponse(providerInvoice(), 201);
    });
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        events.push(`database:${name}`);
        if (name === "begin_paypal_invoice_create") return {
          data: {
            claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
            clientEmail: "client@example.test", clientName: "Client", milestoneTitle: "Discovery",
          }, error: null,
        };
        if (name === "finalize_paypal_operation") return { data: { invoice: persistedDraft, claimState: values?.p_outcome }, error: null };
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`, headers: { authorization: "Bearer user-access-token" } });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({ outcome: "created", invoice: { id: invoiceId, status: "draft", invoiceNumber, invoiceUrl } });
    expect(JSON.stringify(body)).not.toContain("client@example.test");
    expect(JSON.stringify(body)).not.toContain("sandbox-access-token");
    expect(events[0]).toBe("database:begin_paypal_invoice_create");
    expect(events[1]).toBe("provider:https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(serviceRpc).toHaveBeenCalledWith("begin_paypal_invoice_create", expect.objectContaining({ p_actor_id: actorId, p_milestone_id: milestoneId }));
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "completed", p_provider_invoice_id: "PAYPAL-INV-1" }));
  });

  it("does not contact PayPal if the database rejects the caller's milestone claim", async () => {
    const fetch = vi.fn(async () => jsonResponse({ access_token: "token", expires_in: 3600 }));
    const { appPromise } = appFixture({ fetch, serviceRpc: async () => ({ data: null, error: { code: "42501" } }) });
    app = await appPromise;
    const response = await app.inject({ method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("commits a separate send claim before sending and persists PayPal's current invoice state", async () => {
    const events: string[] = [];
    const fetch = clientFetch(async (url, init) => {
      events.push(`provider:${url}`);
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.endsWith("/v2/invoicing/invoices/PAYPAL-INV-1/send")) {
        expect(init?.body).toBe(JSON.stringify({ send_to_recipient: true }));
        return new Response(null, { status: 202 });
      }
      return jsonResponse(providerInvoice({ status: "SENT" }));
    });
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        events.push(`database:${name}`);
        if (name === "begin_paypal_invoice_send") return { data: {
          claimed: true, invoice: pendingSendInvoice, claim: { id: claimId, state: "claimed" },
        }, error: null };
        if (name === "finalize_paypal_operation") return { data: { invoice: persistedSent, claimState: values?.p_outcome }, error: null };
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: "sent", invoice: { status: "sent", providerStatus: "SENT" } });
    expect(events[0]).toBe("database:begin_paypal_invoice_send");
    expect(events[1]).toBe("provider:https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(serviceRpc).toHaveBeenCalledWith("begin_paypal_invoice_send", expect.objectContaining({ p_invoice_id: invoiceId, p_actor_id: actorId }));
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "completed", p_provider_status: "SENT" }));
  });

  it("re-reads a send timeout and completes the claim when PayPal reports SENT", async () => {
    const urls: string[] = [];
    const fetch = clientFetch(async (url) => {
      urls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.endsWith("/v2/invoicing/invoices/PAYPAL-INV-1/send")) throw new TypeError("socket closed after send");
      return jsonResponse(providerInvoice({ status: "SENT" }));
    });
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_send") return { data: { claimed: true, invoice: pendingSendInvoice, claim: { id: claimId, state: "claimed" } }, error: null };
        if (name === "finalize_paypal_operation") return { data: { invoice: persistedSent, claimState: values?.p_outcome }, error: null };
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: "sent", invoice: { status: "sent" } });
    expect(urls).toContain("https://api-m.sandbox.paypal.com/v2/invoicing/invoices/PAYPAL-INV-1");
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "completed", p_provider_status: "SENT" }));
  });

  it("does not repeat a send when an active or completed database claim already exists", async () => {
    const fetch = vi.fn(async () => jsonResponse({ access_token: "token", expires_in: 3600 }));
    const { appPromise } = appFixture({
      fetch,
      serviceRpc: async () => ({ data: { claimed: false, invoice: persistedSent, claim: { id: claimId, state: "completed" } }, error: null }),
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: "already_exists", invoice: { status: "sent" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("releases a send claim when OAuth fails before the send request is transmitted", async () => {
    const urls: string[] = [];
    const fetch = clientFetch(async (url) => {
      urls.push(url);
      return jsonResponse({ name: "AUTHENTICATION_FAILURE", message: "private provider message", debug_id: "debug-secret" }, 401);
    });
    const outcomes: string[] = [];
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_send") return { data: { claimed: true, invoice: pendingSendInvoice, claim: { id: claimId, state: "claimed" } }, error: null };
        if (name === "finalize_paypal_operation") {
          outcomes.push(String(values?.p_outcome));
          return { data: { invoice: persistedDraft }, error: null };
        }
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "PayPal Sandbox credentials or invoice permissions need attention." });
    expect(urls).toEqual(["https://api-m.sandbox.paypal.com/v1/oauth2/token"]);
    expect(outcomes).toEqual(["rejected"]);
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "rejected" }));
  });

  it("reconciles a create timeout by invoice number and leaves an absent result unknown", async () => {
    const calls: string[] = [];
    const fetch = clientFetch(async (url) => {
      calls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.endsWith("/v2/invoicing/invoices")) throw new TypeError("connection ended after write");
      return jsonResponse({ items: [], total_pages: 1 });
    });
    const outcomes: string[] = [];
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "client@example.test", milestoneTitle: "Discovery",
        }, error: null };
        if (name === "finalize_paypal_operation") {
          outcomes.push(String(values?.p_outcome));
          return { data: { invoice: { ...claimedInvoice, status: "unknown" } }, error: null };
        }
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ outcome: "unknown", invoice: { status: "unknown" } });
    expect(calls.filter((url) => url.includes("/search-invoices"))).toHaveLength(1);
    expect(outcomes).toEqual(["unknown"]);
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "unknown" }));
  });

  it("does not search for an invoice when OAuth fails before the create write", async () => {
    const urls: string[] = [];
    const fetch = clientFetch(async (url) => {
      urls.push(url);
      return jsonResponse({ name: "AUTHENTICATION_FAILURE", message: "private provider message", debug_id: "debug-secret" }, 401);
    });
    const outcomes: string[] = [];
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "client@example.test", milestoneTitle: "Discovery",
        }, error: null };
        if (name === "finalize_paypal_operation") {
          outcomes.push(String(values?.p_outcome));
          return { data: { invoice: { ...claimedInvoice, status: "not_created" } }, error: null };
        }
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({ method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`, headers: { authorization: "Bearer user-access-token" } });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "PayPal Sandbox credentials or invoice permissions need attention." });
    expect(urls).toEqual(["https://api-m.sandbox.paypal.com/v1/oauth2/token"]);
    expect(outcomes).toEqual(["rejected"]);
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "rejected" }));
  });

  it("does not process a webhook when PayPal verification fails", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? jsonResponse({ access_token: "token", expires_in: 3600 })
      : jsonResponse({ verification_status: "FAILURE" }));
    const { appPromise, serviceRpc } = appFixture({ fetch });
    app = await appPromise;

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
        "paypal-transmission-id": "transmission-1",
        "paypal-transmission-sig": "signature",
        "paypal-transmission-time": "2026-10-29T12:00:00Z",
      },
      payload: { id: "event-1", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "PayPal webhook signature verification failed." });
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("re-reads an invoice after webhook verification and persists only the authoritative state", async () => {
    const paths: string[] = [];
    const fetch = clientFetch(async (url) => {
      paths.push(url);
      if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) return jsonResponse({ verification_status: "SUCCESS" });
      return jsonResponse(providerInvoice({ status: "PAID", payment_date: "2026-10-29T12:30:00Z" }));
    });
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name) => name === "apply_verified_paypal_webhook"
        ? { data: { duplicate: false, matched: true, invoiceId, status: "paid" }, error: null }
        : { data: null, error: null },
    });
    app = await appPromise;

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
        "paypal-transmission-id": "transmission-2",
        "paypal-transmission-sig": "signature",
        "paypal-transmission-time": "2026-10-29T12:00:00Z",
      },
      payload: { id: "event-2", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1", status: "SENT" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ verified: true, processed: true, result: { matched: true, status: "paid" } });
    expect(paths).toContain("https://api-m.sandbox.paypal.com/v2/invoicing/invoices/PAYPAL-INV-1");
    expect(serviceRpc).toHaveBeenCalledWith("apply_verified_paypal_webhook", expect.objectContaining({
      p_provider_event_id: "event-2",
      p_provider_status: "PAID",
      p_invoice_status: "paid",
      p_paid_at: "2026-10-29T12:30:00Z",
    }));
  });
});
