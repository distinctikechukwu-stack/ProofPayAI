import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory, SupabasePort } from "../src/supabase.js";

const reportId = "3f1c7828-f1dc-48b5-b7a8-60dbcd59bc76";

function authenticatedFactory(options: { rpcData?: unknown; rpcError?: unknown; rows?: Record<string, unknown[]> } = {}) {
  const rpc = vi.fn(async () => ({ data: options.rpcData ?? { saved: true }, error: options.rpcError ?? null }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "account-from-session" } }, error: null }));
  const filters: Array<[string, string]> = [];
  const client = {
    auth: { getUser },
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => { filters.push([column, value]); return query; }),
        limit: vi.fn(() => query),
        order: vi.fn(async () => ({ data: options.rows?.account_deletion_requests ?? [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      };
      return query;
    }),
    rpc,
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, client, getUser, rpc, filters };
}

describe("commercial hardening API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("sets baseline security headers on API responses", async () => {
    app = await buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "x-permitted-cross-domain-policies": "none",
      "cache-control": "no-store",
    });
    expect(response.headers["permissions-policy"]).toContain("microphone=()");
  });

  it("requires the exact deletion confirmation before invoking the account RPC", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: "/api/account/deletion", headers: { authorization: "Bearer valid-token" },
      payload: { confirmation: "delete my account", userId: "another-account" },
    });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("records a deletion request without accepting a caller-supplied account identity", async () => {
    const supabase = authenticatedFactory({ rpcData: { requestId: reportId, status: "requested", alreadyRequested: false } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: "/api/account/deletion", headers: { authorization: "Bearer valid-token" },
      payload: { confirmation: "REQUEST DELETION" },
    });
    expect(response.statusCode).toBe(202);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.rpc).toHaveBeenCalledWith("request_account_deletion", { p_confirmation: "REQUEST DELETION" });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("account-from-session");
  });

  it("cancels only through the actor-bound database action and rejects status overrides", async () => {
    const supabase = authenticatedFactory({ rpcData: { requestId: reportId, status: "cancelled" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const invalid = await app.inject({
      method: "POST", url: "/api/account/deletion/cancel", headers: { authorization: "Bearer valid-token" },
      payload: { userId: "another-account", status: "cancelled" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();

    const response = await app.inject({ method: "POST", url: "/api/account/deletion/cancel", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("cancel_account_deletion_request");
  });

  it("scopes deletion status lookup to the authenticated user and validates its projection", async () => {
    const supabase = authenticatedFactory({ rows: { account_deletion_requests: [{
      id: reportId, status: "under_review", created_at: "2026-10-30T10:00:00Z", updated_at: "2026-10-30T11:00:00Z",
      reviewed_at: "2026-10-30T11:00:00Z", resolution_note: "Review is in progress.",
    }] } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/account/deletion", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(supabase.filters).toContainEqual(["user_id", "account-from-session"]);
    expect(response.json().request).toMatchObject({ id: reportId, status: "under_review" });
  });

  it("leaves administrator authorization to the role-checked database RPC and returns a safe denial", async () => {
    const supabase = authenticatedFactory({ rpcError: { code: "42501", message: "private database detail" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/admin/moderation", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "You do not have access to perform this action." });
    expect(supabase.rpc).toHaveBeenCalledWith("moderation_queue_for_admin");
    expect(response.body).not.toContain("private database detail");
  });

  it("validates and returns the private moderation queue projection", async () => {
    const supabase = authenticatedFactory({ rpcData: {
      jobReports: [{ id: reportId, jobTitle: "Landing page", reason: "suspicious", details: "Repeated links.", status: "actioned", decision: null, resolutionNote: "", createdAt: "2026-10-30T10:00:00Z", reviewedAt: null, moderationHold: false }],
      conversationReports: [], deletionRequests: [],
    } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/admin/moderation", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().jobReports[0]).toMatchObject({ id: reportId, status: "actioned" });
    expect(response.body).not.toContain("reporterId");
  });

  it("rejects malformed moderation queue rows without forwarding private identifiers", async () => {
    const supabase = authenticatedFactory({ rpcData: {
      jobReports: [{ id: reportId, jobTitle: "Landing page", reason: "suspicious", details: "", status: "pending", decision: null, resolutionNote: "", createdAt: "2026-10-30T10:00:00Z", reviewedAt: null, moderationHold: false, reporterId: "private-user-id" }],
      conversationReports: [], deletionRequests: [],
    } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/admin/moderation", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("private-user-id");
  });

  it("validates admin review input and forwards only the report key and approved decision", async () => {
    const supabase = authenticatedFactory({ rpcData: { reportId, status: "reviewed", decision: "escalate" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const invalid = await app.inject({ method: "POST", url: `/api/admin/moderation/jobs/${reportId}`, headers: { authorization: "Bearer valid-token" }, payload: { decision: "delete_user", role: "admin" } });
    expect(invalid.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();

    const response = await app.inject({ method: "POST", url: `/api/admin/moderation/jobs/${reportId}`, headers: { authorization: "Bearer valid-token" }, payload: { decision: "escalate", note: "Needs operator review." } });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("review_marketplace_job_report", {
      p_report_id: reportId, p_decision: "escalate", p_note: "Needs operator review.",
    });
  });
});
