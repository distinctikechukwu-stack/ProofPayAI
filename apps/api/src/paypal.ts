import { Buffer } from "node:buffer";
import { z } from "zod";

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const PAYPAL_REQUEST_TIMEOUT_MS = 15_000;
const PAYPAL_WEBHOOK_REQUEST_TIMEOUT_MS = 8_000;
const PAYPAL_INVOICE_WRITE_SCOPES = new Set([
  "https://uri.paypal.com/services/invoicing/invoices/readwrite",
  "https://uri.paypal.com/services/invoicing",
  "https://api.paypal.com/v1/invoicing:*",
]);

const oauthResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

const paypalErrorSchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional(), description: z.string().optional() }).passthrough()).optional(),
}).passthrough();

const invoiceResponseSchema = z.object({
  id: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  detail: z.object({
    invoice_number: z.string().optional(),
    metadata: z.object({
      last_update_time: z.string().optional(),
      update_time: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  invoice_number: z.string().optional(),
  due_date: z.string().optional(),
  payments: z.object({ transactions: z.unknown().optional() }).passthrough().nullable().optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string().url() }).passthrough()).optional(),
}).passthrough();

const searchResponseSchema = z.object({
  items: z.array(invoiceResponseSchema).default([]),
  total_pages: z.number().int().positive().optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string().url() }).passthrough()).optional(),
}).passthrough();

const webhookVerificationSchema = z.object({ verification_status: z.string() }).passthrough();

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  webhookVerificationTimeoutMs?: number;
  fetch?: typeof fetch;
}

export interface PaypalInvoice {
  id: string;
  status: string;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  providerUpdatedAt: string | null;
}

export class PaypalApiError extends Error {
  constructor(readonly status: number, message: string, readonly debugId: string | null = null) {
    super(message);
    this.name = "PaypalApiError";
  }
}

export class PaypalReadError extends Error {
  constructor() {
    super("PayPal Sandbox could not be reached. Try again after checking the integration status.");
    this.name = "PaypalReadError";
  }
}

export class PaypalPermissionError extends Error {
  constructor() {
    super("PayPal Sandbox OAuth token is missing the required Invoicing permission.");
    this.name = "PaypalPermissionError";
  }
}

export class PaypalWriteUnknownError extends Error {
  constructor() {
    super("PayPal did not return a response. The outcome is unknown and must be reconciled before another attempt.");
    this.name = "PaypalWriteUnknownError";
  }
}

export function paypalConfigFromEnvironment(): PaypalConfig | null {
  const clientId = process.env.PAYPAL_SANDBOX_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET?.trim();
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!isRealValue(clientId) || !isRealValue(clientSecret)) return null;
  return { clientId, clientSecret, ...(isRealValue(webhookId) ? { webhookId } : {}) };
}

export function isPaypalConfigReady(config: PaypalConfig | null): boolean {
  return Boolean(config && isRealValue(config.clientId) && isRealValue(config.clientSecret));
}

export function isPaypalWebhookReady(config: PaypalConfig | null): boolean {
  return Boolean(config && isRealValue(config.webhookId));
}

function isRealValue(value: string | undefined): value is string {
  return Boolean(value && value.trim() && !/^your[-_]/i.test(value.trim()));
}

function invoiceFromProvider(value: unknown): PaypalInvoice {
  const invoice = invoiceResponseSchema.parse(value);
  if (!invoice.id || !invoice.status) throw new Error("PayPal returned an incomplete invoice response.");
  const payerLink = invoice.links?.find((link) => link.rel === "payer-view")
    ?? invoice.links?.find((link) => link.rel === "invoice");
  return {
    id: invoice.id,
    status: invoice.status,
    invoiceNumber: invoice.detail?.invoice_number ?? invoice.invoice_number ?? null,
    invoiceUrl: payerLink?.href?.startsWith("https://") ? payerLink.href : null,
    paidAt: parseInvoicePaidAt(invoice.status, invoice.payments),
    providerUpdatedAt: parseProviderUpdatedAt(invoice.detail?.metadata?.last_update_time ?? invoice.detail?.metadata?.update_time),
  };
}

const invoicePaymentsResponseSchema = z.object({
  transactions: z.unknown().optional(),
}).passthrough().nullable().optional();

const invoicePaymentTransactionSchema = z.object({
  payment_date: z.unknown().optional(),
  payment_date_time: z.unknown().optional(),
}).passthrough();

function parseInvoicePaidAt(status: string, payments: unknown): string | null {
  if (status !== "PAID") return null;

  const parsedPayments = invoicePaymentsResponseSchema.safeParse(payments);
  const transactions = parsedPayments.success ? parsedPayments.data?.transactions : undefined;
  if (!Array.isArray(transactions) || transactions.length === 0) return null;

  const candidates: Array<{ dateTime: string | null; dateOnly: string | null }> = [];
  for (const transaction of transactions) {
    const parsedTransaction = invoicePaymentTransactionSchema.safeParse(transaction);
    if (!parsedTransaction.success) return null;
    candidates.push({
      dateTime: parseValidPayPalDateTime(parsedTransaction.data.payment_date_time),
      dateOnly: parseValidPayPalDateOnly(parsedTransaction.data.payment_date),
    });
  }

  if (candidates.every((candidate) => candidate.dateTime !== null)) {
    return latestPaymentTimestamp(candidates.map((candidate) => candidate.dateTime as string));
  }

  // Use date-only precision only when every payment transaction has that same precision.
  if (candidates.every((candidate) => candidate.dateTime === null && candidate.dateOnly !== null)) {
    return latestPaymentTimestamp(candidates.map((candidate) => candidate.dateOnly as string));
  }

  // An incomplete or mixed-precision history cannot identify when the invoice became paid.
  return null;
}

function latestPaymentTimestamp(values: string[]): string {
  return values.reduce((latest, candidate) =>
    Date.parse(candidate) > Date.parse(latest) ? candidate : latest,
  );
}

function parseValidPayPalDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !z.string().datetime({ offset: true }).safeParse(value).success) return null;
  if (!isValidPayPalCalendarDate(value.slice(0, 10))) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function parseValidPayPalDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !isValidPayPalCalendarDate(value)) return null;
  return value + "T00:00:00.000Z";
}

function isValidPayPalCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysByMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= (daysByMonth[month - 1] ?? 0);
}

function parseProviderUpdatedAt(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = parseValidPayPalDateTime(value);
  if (parsed === null) throw new Error("PayPal returned a malformed invoice update timestamp.");
  return parsed;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => [key, canonicalizeJsonValue(record[key])]));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeJsonValue(left)) === JSON.stringify(canonicalizeJsonValue(right));
}

function safeProviderMessage(value: unknown): { message: string; debugId: string | null; details: string[] } {
  const parsed = paypalErrorSchema.safeParse(value);
  if (!parsed.success) return { message: "PayPal Sandbox rejected the request.", debugId: null, details: [] };
  const details = parsed.data.details?.flatMap((detail) => [detail.description, detail.issue]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)) ?? [];
  return {
    message: parsed.data.message?.trim() || parsed.data.name?.trim() || "PayPal Sandbox rejected the request.",
    debugId: parsed.data.debug_id ?? null,
    details: [...new Set(details)].slice(0, 4),
  };
}

export function normalizePaypalError(error: unknown): { status: number; message: string } {
  if (error instanceof PaypalPermissionError) return { status: 502, message: "PayPal Sandbox credentials or invoice permissions need attention." };
  if (error instanceof PaypalApiError) {
    if (error.status === 401 || error.status === 403) return { status: 502, message: "PayPal Sandbox credentials or invoice permissions need attention." };
    if (error.status === 429) return { status: 503, message: "PayPal Sandbox is temporarily rate limited. Try again later." };
    if (error.status >= 500) return { status: 502, message: "PayPal Sandbox could not complete the request. Try again later." };
    return { status: error.status === 400 || error.status === 422 ? 422 : error.status, message: error.message };
  }
  if (error instanceof PaypalReadError) return { status: 502, message: error.message };
  return { status: 502, message: "PayPal Sandbox could not complete the request." };
}

export function mapPaypalStatus(providerStatus: string): string {
  switch (providerStatus.toUpperCase()) {
    case "DRAFT": return "draft";
    case "SENT":
    case "UNPAID": return "sent";
    case "SCHEDULED": return "scheduled";
    case "PAYMENT_PENDING": return "payment_pending";
    case "PARTIALLY_PAID": return "partially_paid";
    case "PAID":
      return "paid";
    case "MARKED_AS_PAID":
    case "PAID_EXTERNAL": return "paid_external";
    case "CANCELLED":
    case "AUTO_CANCELLED": return "cancelled";
    case "REFUNDED": return "refunded";
    case "MARKED_AS_REFUNDED":
    case "REFUNDED_EXTERNAL": return "refunded_external";
    case "PARTIALLY_REFUNDED": return "partially_refunded";
    default: return "unknown";
  }
}

export class PaypalClient {
  private readonly requestFetch: typeof fetch;
  private token: { value: string; refreshAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(private readonly config: PaypalConfig) {
    this.requestFetch = config.fetch ?? fetch;
  }

  async createInvoice(input: {
    invoiceNumber: string;
    currency: string;
    invoiceDate: string;
    clientEmail: string;
    milestoneTitle: string;
    amountDecimal: string;
  }): Promise<PaypalInvoice> {
    const response = await this.request("/v2/invoicing/invoices", {
      method: "POST",
      body: {
        detail: {
          currency_code: input.currency,
          invoice_number: input.invoiceNumber,
          invoice_date: input.invoiceDate,
        },
        primary_recipients: [{ billing_info: { email_address: input.clientEmail } }],
        items: [{
          name: input.milestoneTitle,
          quantity: "1",
          unit_amount: { currency_code: input.currency, value: input.amountDecimal },
        }],
      },
      write: true,
      expected: [201],
    });
    try {
      return invoiceFromProvider(response);
    } catch {
      throw new PaypalWriteUnknownError();
    }
  }

  async sendInvoice(invoiceId: string): Promise<PaypalInvoice | null> {
    const response = await this.request(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
      method: "POST",
      body: { send_to_recipient: true },
      write: true,
      expected: [200, 202],
      allowEmpty: true,
    });
    if (response === null) return null;
    try {
      return invoiceFromProvider(response);
    } catch {
      throw new PaypalWriteUnknownError();
    }
  }

  async showInvoice(invoiceId: string): Promise<PaypalInvoice> {
    const response = await this.request(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`, { method: "GET", expected: [200] });
    return invoiceFromProvider(response);
  }

  async findInvoices(invoiceNumber: string): Promise<PaypalInvoice[]> {
    const found: PaypalInvoice[] = [];
    let page = 1;
    while (page <= 1000) {
      const response = await this.request(
        `/v2/invoicing/search-invoices?page=${page}&page_size=100&total_required=true`,
        { method: "POST", body: { invoice_number: invoiceNumber }, expected: [200] },
      );
      const parsed = searchResponseSchema.parse(response);
      found.push(...parsed.items.map(invoiceFromProvider).filter((invoice) => invoice.invoiceNumber === invoiceNumber));
      if (parsed.total_pages !== undefined) {
        if (page >= parsed.total_pages) break;
      } else if (parsed.items.length < 100) {
        break;
      }
      page += 1;
    }
    return found;
  }

  async verifyWebhook(
    event: unknown,
    headers: { authAlgo: string; certUrl: string; transmissionId: string; transmissionSignature: string; transmissionTime: string },
    rawEventJson: string,
  ): Promise<boolean> {
    if (!isRealValue(this.config.webhookId)) throw new Error("A PayPal Sandbox webhook ID is not configured.");
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(rawEventJson) as unknown;
    } catch {
      throw new PaypalReadError();
    }
    if (!sameJsonValue(rawEvent, event)) throw new PaypalReadError();
    const response = await this.request("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      serializedBody: `${JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSignature,
        transmission_time: headers.transmissionTime,
        webhook_id: this.config.webhookId,
      }).slice(0, -1)},"webhook_event":${rawEventJson}}`,
      timeoutMs: this.config.webhookVerificationTimeoutMs ?? PAYPAL_WEBHOOK_REQUEST_TIMEOUT_MS,
      expected: [200],
    });
    return webhookVerificationSchema.parse(response).verification_status === "SUCCESS";
  }

  private async getAccessToken(timeoutMs = PAYPAL_REQUEST_TIMEOUT_MS): Promise<string> {
    if (this.token && this.token.refreshAt > Date.now()) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      let response: Response;
      try {
        response = await this.requestFetch(`${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        });
      } catch {
        throw new PaypalReadError();
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) this.throwProviderError(response.status, body);
      const parsed = oauthResponseSchema.safeParse(body);
      if (!parsed.success) throw new PaypalReadError();
      const grantedScopes = new Set(parsed.data.scope?.trim().split(/\s+/).filter(Boolean) ?? []);
      if (parsed.data.token_type?.toLowerCase() !== "bearer"
        || ![...PAYPAL_INVOICE_WRITE_SCOPES].some((scope) => grantedScopes.has(scope))) {
        throw new PaypalPermissionError();
      }
      this.token = { value: parsed.data.access_token, refreshAt: Date.now() + Math.max(0, parsed.data.expires_in - 60) * 1000 };
      return parsed.data.access_token;
    })();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }

  private async request(path: string, options: {
    method: "GET" | "POST";
    body?: unknown;
    serializedBody?: string;
    expected: number[];
    write?: boolean;
    allowEmpty?: boolean;
    timeoutMs?: number;
  }): Promise<unknown | null> {
    const timeoutMs = options.timeoutMs ?? PAYPAL_REQUEST_TIMEOUT_MS;
    const token = await this.getAccessToken(timeoutMs);
    let response: Response;
    try {
      response = await this.requestFetch(`${PAYPAL_SANDBOX_BASE_URL}${path}`, {
        method: options.method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.body === undefined && options.serializedBody === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.serializedBody === undefined
          ? options.body === undefined ? {} : { body: JSON.stringify(options.body) }
          : { body: options.serializedBody }),
      });
    } catch {
      if (options.write) throw new PaypalWriteUnknownError();
      throw new PaypalReadError();
    }
    const body: unknown = await response.json().catch(() => null);
    if (!options.expected.includes(response.status)) this.throwProviderError(response.status, body);
    if (body === null && options.allowEmpty) return null;
    if (body === null) {
      if (options.write) throw new PaypalWriteUnknownError();
      throw new PaypalReadError();
    }
    return body;
  }

  private throwProviderError(status: number, body: unknown): never {
    const safe = safeProviderMessage(body);
    const message = [safe.message, ...safe.details].join(" — ");
    throw new PaypalApiError(status, message, safe.debugId);
  }
}
