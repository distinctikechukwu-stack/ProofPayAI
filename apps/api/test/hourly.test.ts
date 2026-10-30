import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory, SupabasePort } from "../src/supabase.js";

const projectId = "cf612978-5aac-4ec9-b966-3fd46ad41255";
const entryKey = "6fd3ee6c-68f1-43f3-9c02-3fd9c71f6b91";

function authenticatedFactory(rows: Record<string, Record<string, unknown>[]> = {}) {
  const rpc = vi.fn(async () => ({ data: { entryId: "entry-1", status: "draft" }, error: null }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "auth-derived-user" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        limit: vi.fn(() => query),
        order: vi.fn(async () => ({ data: rows[table] ?? [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null })),
      };
      return query;
    }),
    rpc,
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, rpc, getUser };
}

describe("hourly work API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("rejects caller identity and fractional seconds before the database boundary", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/hourly/entries`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: entryKey, workDate: "2026-10-30", durationSeconds: 3600.5, description: "Review client feedback", actorId: "attacker-id",
    } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends a validated time entry through the session-bound RPC without caller ownership claims", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/hourly/entries`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: entryKey, workDate: "2026-10-30", durationSeconds: 3600, description: "Review client feedback",
    } });
    expect(response.statusCode).toBe(201);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.rpc).toHaveBeenCalledWith("create_manual_hourly_time_entry", {
      p_project_id: projectId,
      p_input: { idempotencyKey: entryKey, workDate: "2026-10-30", durationSeconds: 3600, description: "Review client feedback" },
    });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("auth-derived-user");
  });

  it("rejects caller-supplied hourly invoice amounts and entry selections", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/invoices/hourly/projects/${projectId}/create`, headers: { authorization: "Bearer valid-token" }, payload: {
      amountMinor: "1", hourlyRateMinor: "1", entryIds: ["client-selected-entry"],
    } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("recomputes hourly invoice candidate totals exactly and omits inconsistent rows", async () => {
    const supabase = authenticatedFactory({ hourly_invoice_candidates_for_user: [
      { project_id: projectId, project_title: "Client portal", client_name: "Jordan Studio", hourly_rate_minor: "9000", currency: "USD", approved_seconds: 900, amount_minor: "2250", work_date_start: "2026-10-29", work_date_end: "2026-10-30", entry_count: 2 },
      { project_id: "e3b660a1-492b-4879-a94c-a361d6ed2d0b", project_title: "Forged total", client_name: "Client", hourly_rate_minor: "9000", currency: "USD", approved_seconds: 900, amount_minor: "2251", work_date_start: "2026-10-29", work_date_end: "2026-10-30", entry_count: 2 },
    ] });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/invoices/hourly-candidates", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidates).toEqual([expect.objectContaining({ projectId, approvedSeconds: 900, amountMinor: "2250", hourlyRateMinor: "9000" })]);
    expect(response.body).not.toContain("Forged total");
    expect(response.body).not.toContain("freelancer_id");
  });
});
