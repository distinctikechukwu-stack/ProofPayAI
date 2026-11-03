import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  mapPaypalStatus,
  normalizePaypalError,
  PaypalApiError,
  PaypalClient,
  PaypalPermissionError,
  PaypalWriteUnknownError,
} from "../src/paypal.js";
import type { SupabasePort } from "../src/supabase.js";

const actorId = "b720da7f-4342-48d9-813a-186d0ac94896";
const milestoneId = "11a0daff-1e7f-4ca5-88d1-adb655cf3ec8";
const invoiceId = "239f5928-38be-4805-918a-285d9122ab32";
const claimId = "d4da3d57-ab38-4fd2-bb23-a1b27b4f49a7";
const invoiceNumber = "PP-abc123xyz";
const invoiceUrl = "https://www.sandbox.paypal.com/invoice/p/#example";

const claimedInvoice = {
  id: invoiceId,
  project_id: "907a5ffa-fa2b-4b04-a780-f71297594484",
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

const invoiceWriteScope = "https://uri.paypal.com/services/invoicing/invoices/readwrite";
const generalInvoiceScope = "https://uri.paypal.com/services/invoicing";
const fullInvoiceScope = "https://api.paypal.com/v1/invoicing:*";

function paypalOAuthResponse(token = "token", scope = invoiceWriteScope): Response {
  return jsonResponse({ access_token: token, token_type: "Bearer", expires_in: 3600, scope });
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
  paypalWebhookEnqueueTimeoutMs?: number;
  paypalWebhookVerificationTimeoutMs?: number;
  webhookId?: string | null;
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
    paypalWebhookEnqueueTimeoutMs: args.paypalWebhookEnqueueTimeoutMs,
    paypal: {
      clientId: "sandbox-client-id",
      clientSecret: "sandbox-client-secret",
      ...(args.webhookId === null ? {} : { webhookId: args.webhookId ?? "sandbox-webhook-id" }),
      webhookVerificationTimeoutMs: args.paypalWebhookVerificationTimeoutMs,
      fetch: args.fetch,
    },
  });
  return { appPromise, serviceRpc };
}

describe("PayPal Sandbox REST boundary", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each([invoiceWriteScope, generalInvoiceScope, fullInvoiceScope])("accepts the documented invoice write scope %s", async (scope) => {
    const calls: string[] = [];
    const fetch = clientFetch(async (url) => {
      calls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse("sandbox-token", `openid ${scope} profile`);
      return jsonResponse(providerInvoice(), 201);
    });
    const client = new PaypalClient({ clientId: "sandbox-client-id", clientSecret: "sandbox-client-secret", fetch });

    const result = await client.createInvoice({
      invoiceNumber, currency: "USD", invoiceDate: "2026-11-02", clientEmail: "release-test-user-002@example.invalid",
      milestoneTitle: "Discovery", amountDecimal: "150.00",
    });

    expect(result.status).toBe("DRAFT");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices");
  });

  it.each([
    { label: "missing scope", token: { access_token: "token", token_type: "Bearer", expires_in: 3600 } },
    { label: "unrelated scope", token: { access_token: "token", token_type: "Bearer", expires_in: 3600, scope: "openid profile" } },
    { label: "read-only scope", token: { access_token: "token", token_type: "Bearer", expires_in: 3600, scope: "https://uri.paypal.com/services/invoicing/invoices/read" } },
  ])("rejects OAuth with $label before an invoice request", async ({ token }) => {
    const calls: string[] = [];
    const fetch = clientFetch(async (url) => {
      calls.push(url);
      return jsonResponse(token);
    });
    const client = new PaypalClient({ clientId: "sandbox-client-id", clientSecret: "sandbox-client-secret", fetch });

    await expect(client.createInvoice({
      invoiceNumber, currency: "USD", invoiceDate: "2026-11-02", clientEmail: "release-test-user-002@example.invalid",
      milestoneTitle: "Discovery", amountDecimal: "150.00",
    })).rejects.toBeInstanceOf(PaypalPermissionError);

    expect(calls).toEqual(["https://api-m.sandbox.paypal.com/v1/oauth2/token"]);
    expect(normalizePaypalError(new PaypalPermissionError())).toEqual({
      status: 502, message: "PayPal Sandbox credentials or invoice permissions need attention.",
    });
  });

  it("uses Sandbox OAuth and sends exact decimal invoice fields without returning credentials", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch = clientFetch(async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse("sandbox-token");
      return jsonResponse(providerInvoice(), 201);
    });
    const client = new PaypalClient({ clientId: "sandbox-client-id", clientSecret: "sandbox-client-secret", webhookId: "sandbox-webhook-id", fetch });

    const result = await client.createInvoice({
      invoiceNumber,
      currency: "USD",
      invoiceDate: "2026-10-29",
      clientEmail: "release-test-user-002@example.invalid",
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
    expect(requests[1]?.init?.headers).toMatchObject({ Authorization: "Bearer sandbox-token" });
    const body = JSON.parse(String(requests[1]?.init?.body));
    expect(body).toMatchObject({
      detail: { currency_code: "USD", invoice_number: invoiceNumber, invoice_date: "2026-10-29" },
      primary_recipients: [{ billing_info: { email_address: "release-test-user-002@example.invalid" } }],
      items: [{ name: "Discovery milestone", quantity: "1", unit_amount: { currency_code: "USD", value: "150.00" } }],
    });
    expect(JSON.stringify(result)).not.toContain("sandbox-token");
    expect(JSON.stringify(result)).not.toContain("sandbox-client-secret");
  });

  it("searches every result page and matches the exact persisted invoice number", async () => {
    const urls: string[] = [];
    const fetch = clientFetch(async (url) => {
      urls.push(url);
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse();
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
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse();
      throw new TypeError("socket closed");
    });
    const client = new PaypalClient({ clientId: "id", clientSecret: "secret", fetch });

    await expect(client.createInvoice({
      invoiceNumber, currency: "USD", invoiceDate: "2026-10-29", clientEmail: "release-test-user-002@example.invalid",
      milestoneTitle: "Discovery", amountDecimal: "150.00",
    })).rejects.toBeInstanceOf(PaypalWriteUnknownError);
    expect(calls).toBe(2);
  });

  it("keeps an unfamiliar provider state unknown and leaves its operation available for reconciliation", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? paypalOAuthResponse()
      : jsonResponse(providerInvoice({ status: "FUTURE_PROVIDER_STATE" }), 201));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "release-test-user-002@example.invalid", milestoneTitle: "Discovery",
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
      ? paypalOAuthResponse()
      : jsonResponse(providerInvoice({ status: "PAID" }), 201));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "release-test-user-002@example.invalid", milestoneTitle: "Discovery",
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
    const invoicePayloads: unknown[] = [];
    const fetch = clientFetch(async (url, init) => {
      events.push(`provider:${url}`);
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse("sandbox-token");
      invoicePayloads.push(JSON.parse(String(init?.body)));
      return jsonResponse(providerInvoice(), 201);
    });
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        events.push(`database:${name}`);
        if (name === "begin_paypal_invoice_create") return {
          data: {
            claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
            clientEmail: "release-test-user-002@example.invalid", clientName: "Client", milestoneTitle: "Discovery",
          }, error: null,
        };
        if (name === "finalize_paypal_operation") return { data: { invoice: persistedDraft, claimState: values?.p_outcome }, error: null };
        return { data: null, error: null };
      },
    });
    app = await appPromise;

    const response = await app.inject({
      method: "POST", url: `/api/invoices/milestones/${milestoneId}/create`,
      headers: { authorization: "Bearer user-access-token" },
      body: { clientEmail: "release-test-user-003@example.invalid", billingEmail: "release-test-user-003@example.invalid" },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({ outcome: "created", invoice: { id: invoiceId, status: "draft", invoiceNumber, invoiceUrl } });
    expect(JSON.stringify(body)).not.toContain("release-test-user-002@example.invalid");
    expect(JSON.stringify(body)).not.toContain("sandbox-token");
    expect(events[0]).toBe("database:begin_paypal_invoice_create");
    expect(events[1]).toBe("provider:https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(serviceRpc).toHaveBeenCalledWith("begin_paypal_invoice_create", expect.objectContaining({ p_actor_id: actorId, p_milestone_id: milestoneId }));
    expect(serviceRpc).toHaveBeenCalledWith("finalize_paypal_operation", expect.objectContaining({ p_outcome: "completed", p_provider_invoice_id: "PAYPAL-INV-1" }));
    expect(invoicePayloads).toHaveLength(1);
    expect(invoicePayloads[0]).toMatchObject({ primary_recipients: [{ billing_info: { email_address: "release-test-user-002@example.invalid" } }] });
    expect(JSON.stringify(invoicePayloads[0])).not.toContain("release-test-user-003@example.invalid");
  });

  it("does not contact PayPal if the database rejects the caller's milestone claim", async () => {
    const fetch = vi.fn(async () => paypalOAuthResponse());
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
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse();
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
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse();
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
    const fetch = vi.fn(async () => paypalOAuthResponse());
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
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse();
      if (url.endsWith("/v2/invoicing/invoices")) throw new TypeError("connection ended after write");
      return jsonResponse({ items: [], total_pages: 1 });
    });
    const outcomes: string[] = [];
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name, values) => {
        if (name === "begin_paypal_invoice_create") return { data: {
          claimed: true, invoice: claimedInvoice, claim: { id: claimId, state: "claimed" },
          clientEmail: "release-test-user-002@example.invalid", milestoneTitle: "Discovery",
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
          clientEmail: "release-test-user-002@example.invalid", milestoneTitle: "Discovery",
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
      ? paypalOAuthResponse()
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

  it("serves the API without a webhook ID while keeping webhook delivery disabled", async () => {
    const fetch = vi.fn(async () => jsonResponse({ verification_status: "SUCCESS" }));
    const { appPromise, serviceRpc } = appFixture({ fetch, webhookId: null });
    app = await appPromise;

    const health = await app.inject({ method: "GET", url: "/health" });
    const status = await app.inject({ method: "GET", url: "/api/status" });
    const webhook = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("webhook-id-unconfigured") },
      payload: { id: "event-webhook-id-unconfigured", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1" } },
    });

    expect(health.statusCode).toBe(200);
    expect(status.statusCode).toBe(200);
    expect(status.json().integrations).toMatchObject({ paypal: true, paypalWebhook: false });
    expect(webhook.statusCode).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed transmission timestamp before signature verification", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? paypalOAuthResponse()
      : jsonResponse({ verification_status: "SUCCESS" }));
    const { appPromise, serviceRpc } = appFixture({ fetch });
    app = await appPromise;
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("transmission-bad-time") , "paypal-transmission-time": "not-a-timestamp" },
      payload: { id: "event-bad-time", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1" } },
    });

    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("bounds the cold PayPal OAuth/signature-verification transport and does not enqueue on timeout", async () => {
    const fetch = clientFetch(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const { appPromise, serviceRpc } = appFixture({ fetch, paypalWebhookVerificationTimeoutMs: 5 });
    app = await appPromise;

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("transmission-provider-timeout") },
      payload: { id: "event-provider-timeout", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1" } },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "PayPal Sandbox could not be reached. Try again after checking the integration status." });
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("preserves the exact signed event JSON and acknowledges only after durable queue acceptance", async () => {
    const requests: Array<{ url: string; body: string | undefined }> = [];
    const fetch = clientFetch(async (url, init) => {
      requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/v1/oauth2/token")) return paypalOAuthResponse();
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) return jsonResponse({ verification_status: "SUCCESS" });
      throw new Error("The webhook request must not fetch the provider invoice inline.");
    });
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async (name) => name === "enqueue_verified_paypal_webhook"
        ? { data: { duplicate: false, processed: false, pending: true }, error: null }
        : { data: null, error: null },
    });
    app = await appPromise;
    const rawEvent = '{ "id":"event-2", "event_type":"INVOICING.INVOICE.PAID", "resource": { "id":"PAYPAL-INV-1", "status":"SENT" } }';
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("transmission-2") },
      payload: rawEvent,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ verified: true, accepted: true, duplicate: false });
    expect(requests.map((request) => request.url)).toEqual([
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature",
    ]);
    expect(requests[1]?.body).toContain(`"webhook_event":${rawEvent}`);
    expect(serviceRpc).toHaveBeenCalledTimes(1);
    expect(serviceRpc).toHaveBeenCalledWith("enqueue_verified_paypal_webhook", expect.objectContaining({
      p_provider_event_id: "event-2",
      p_event_type: "INVOICING.INVOICE.PAID",
      p_resource_id: "PAYPAL-INV-1",
    }));
  });

  it("returns a retryable response when durable enqueue fails", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? paypalOAuthResponse()
      : jsonResponse({ verification_status: "SUCCESS" }));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async () => ({ data: null, error: { code: "08006" } }),
    });
    app = await appPromise;
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("transmission-db-failure") },
      payload: { id: "event-db-failure", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1" } },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "The verified PayPal event could not be stored. PayPal may retry delivery." });
    expect(serviceRpc).toHaveBeenCalledTimes(1);
    expect(serviceRpc).toHaveBeenCalledWith("enqueue_verified_paypal_webhook", expect.any(Object));
  });

  it("does not acknowledge an enqueue call that exceeds its storage deadline", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? paypalOAuthResponse()
      : jsonResponse({ verification_status: "SUCCESS" }));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      paypalWebhookEnqueueTimeoutMs: 5,
      serviceRpc: () => new Promise(() => undefined),
    });
    app = await appPromise;
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("transmission-timeout") },
      payload: { id: "event-timeout", event_type: "INVOICING.INVOICE.PAID", resource: { id: "PAYPAL-INV-1" } },
    });

    expect(response.statusCode).toBe(503);
    expect(serviceRpc).toHaveBeenCalledTimes(1);
  });

  it("verifies redeliveries then relies on durable event-ID deduplication", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? paypalOAuthResponse()
      : jsonResponse({ verification_status: "SUCCESS" }));
    const { appPromise, serviceRpc } = appFixture({
      fetch,
      serviceRpc: async () => ({ data: { duplicate: true, processed: true, pending: false }, error: null }),
    });
    app = await appPromise;
    const event = { id: "event-duplicate", event_type: "INVOICING.INVOICE.SENT", resource: { id: "PAYPAL-INV-1" } };
    const deliver = (transmissionId: string) => app!.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders(transmissionId) },
      payload: event,
    });
    const [first, redelivery] = await Promise.all([deliver("transmission-first"), deliver("transmission-redelivery")]);

    expect(first.statusCode).toBe(202);
    expect(redelivery.statusCode).toBe(202);
    expect(redelivery.json()).toEqual({ verified: true, accepted: true, duplicate: true });
    expect(serviceRpc).toHaveBeenCalledTimes(2);
  });

  it("verifies but does not enqueue unsupported event types", async () => {
    const fetch = clientFetch(async (url) => url.endsWith("/v1/oauth2/token")
      ? paypalOAuthResponse()
      : jsonResponse({ verification_status: "SUCCESS" }));
    const { appPromise, serviceRpc } = appFixture({ fetch });
    app = await appPromise;
    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      headers: { "content-type": "application/json", ...webhookHeaders("transmission-unsupported") },
      payload: { id: "event-unrelated", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "PAYMENT-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ verified: true, accepted: false });
    expect(serviceRpc).not.toHaveBeenCalled();
  });
});

function webhookHeaders(transmissionId: string) {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
    "paypal-transmission-id": transmissionId,
    "paypal-transmission-sig": "signature",
    "paypal-transmission-time": "2026-11-02T12:00:00Z",
  };
}
