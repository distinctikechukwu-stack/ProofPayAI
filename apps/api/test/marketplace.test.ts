import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory, SupabasePort, SupabasePublicFactory } from "../src/supabase.js";

const jobId = "4334fa2e-df44-48dd-ad69-00921169c6f2";
const serviceId = "b8bf1bf6-6d84-4acf-8851-e59e69ddd3d4";
const projectId = "1319f6b9-8b9c-4138-8dd7-538b54b902f6";
const proposalId = "b325d370-83d1-43e8-b734-b46ca3f0c4c1";
const offerId = "a9bd7b78-0385-4ff9-ba87-228ae967fa87";

function authenticatedFactory(options: { rows?: Record<string, unknown[]>; rpcData?: unknown; rpcError?: unknown } = {}) {
  const rpc = vi.fn(async () => ({ data: options.rpcData ?? { id: "record-1", status: "saved" }, error: options.rpcError ?? null }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "auth-derived-user" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        limit: vi.fn(() => query),
        order: vi.fn(async () => ({ data: options.rows?.[table] ?? [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: (options.rows?.[table] ?? [])[0] ?? null, error: null })),
      };
      return query;
    }),
    rpc,
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, client, getUser, rpc };
}

describe("marketplace API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("rejects invalid job money before calling the auth.uid-based write RPC", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: "/api/jobs", headers: { authorization: "Bearer valid-token" }, payload: {
      id: null, idempotencyKey: "368af74b-e33e-4016-a37c-12efe9db082d", title: "Accessible client portal",
      summary: "A responsive project portal for a small services business.",
      description: "Build a responsive client portal with account pages, clear navigation, and a documented handover.",
      requirements: ["Keyboard-friendly forms"], skills: ["React"], category: "Development", experienceLevel: "intermediate",
      projectType: "fixed", fixedBudgetMinor: 12.5, hourlyRateMinMinor: null, hourlyRateMaxMinor: null, currency: "USD", estimatedDays: 30,
    } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("derives job ownership from the authenticated database session and stores exact minor units", async () => {
    const supabase = authenticatedFactory({ rpcData: { jobId } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: "/api/jobs", headers: { authorization: "Bearer valid-token" }, payload: {
      id: null, idempotencyKey: "368af74b-e33e-4016-a37c-12efe9db082d", title: "Accessible client portal",
      summary: "A responsive project portal for a small services business.",
      description: "Build a responsive client portal with account pages, clear navigation, and a documented handover.",
      requirements: ["Keyboard-friendly forms"], skills: ["React"], category: "Development", experienceLevel: "intermediate",
      projectType: "fixed", fixedBudgetMinor: 60_000, hourlyRateMinMinor: null, hourlyRateMaxMinor: null, currency: "USD", estimatedDays: 30,
    } });
    expect(response.statusCode).toBe(201);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.rpc).toHaveBeenCalledWith("save_marketplace_job", { p_input: expect.objectContaining({ fixed_budget_minor: "60000" }) });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("created_by");
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("auth-derived-user");
  });

  it("filters job budget ranges with integer comparisons and maps saved status", async () => {
    const rows = {
      marketplace_jobs_for_user: [
        { id: jobId, is_owner: false, title: "React website", summary: "Build a responsive React website.", description: "A sufficiently detailed description for a public listing.", requirements: ["Responsive"], skills: ["React"], category: "Development", experience_level: "intermediate", project_type: "fixed", fixed_budget_minor: "60000", hourly_rate_min_minor: null, hourly_rate_max_minor: null, currency: "USD", estimated_days: 30, status: "published", published_at: "2026-10-30T09:00:00Z", created_at: "2026-10-30T10:00:00Z", updated_at: "2026-10-30T10:00:00Z" },
        { id: "d1acd194-2e39-4834-a54e-65916c11ca52", is_owner: false, title: "Logo refresh", summary: "A visual identity refresh with usage files.", description: "A sufficiently detailed description for this listing.", requirements: ["Vector files"], skills: ["Illustrator"], category: "Design", experience_level: "entry", project_type: "fixed", fixed_budget_minor: "12000", hourly_rate_min_minor: null, hourly_rate_max_minor: null, currency: "USD", estimated_days: 10, status: "published", published_at: "2026-10-29T09:00:00Z", created_at: "2026-10-29T10:00:00Z", updated_at: "2026-10-29T10:00:00Z" },
      ],
      marketplace_job_favorites: [{ job_id: jobId }],
    };
    const supabase = authenticatedFactory({ rows });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/jobs?budgetMinMinor=20000&budgetMaxMinor=70000&skill=React", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().jobs).toHaveLength(1);
    expect(response.json().jobs[0]).toMatchObject({ id: jobId, fixedBudgetMinor: "60000", isFavorite: true });
    expect(response.json().jobs[0].isOwner).toBe(false);
    expect(response.body).not.toContain("created_by");
    expect(response.body).not.toContain("createdBy");
  });

  it("returns only allowlisted public service and package fields", async () => {
    const service = {
      id: serviceId, freelancer_slug: "jordan-rivera", freelancer_name: "Jordan Rivera", slug: "accessible-page",
      title: "Accessible product landing page", description: "A responsive, accessible product page with clear handover.",
      category: "Design", starting_price_minor: "25000", currency: "USD", delivery_days: 7,
      deliverables: ["Landing page"], packages: [{ title: "Standard", description: "One page and review.", priceMinor: "25000", deliveryDays: 7, deliverables: ["Page"], hidden_owner_id: "private-user" }],
      owner_email: "release-test-user-001@example.invalid", portfolio_item_ids: ["private-portfolio-id"],
    };
    const publicClient = { from: vi.fn(() => {
      const query = { select: vi.fn(() => query), limit: vi.fn(() => query), order: vi.fn(async () => ({ data: [service], error: null })) };
      return query;
    }) } as unknown as SupabasePort;
    const createPublicSupabaseClient = vi.fn(() => publicClient) as unknown as SupabasePublicFactory;
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createPublicSupabaseClient });
    const response = await app.inject({ method: "GET", url: "/api/services" });
    expect(response.statusCode).toBe(200);
    expect(response.json().services[0]).toMatchObject({ id: serviceId, freelancerName: "Jordan Rivera", startingPriceMinor: "25000" });
    expect(response.body).not.toContain("release-test-user-001@example.invalid");
    expect(response.body).not.toContain("private-user");
    expect(response.body).not.toContain("portfolio_item_ids");
  });

  it("passes service requests with exact budgets to an actor-derived RPC", async () => {
    const supabase = authenticatedFactory({ rpcData: { requestId: "record-request", status: "pending" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/services/${serviceId}/requests`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: "fe9dd2a8-095b-41a5-813b-a74aeb6b3875", requestText: "Please build a small responsive product page and include a handover session.", budgetMinor: 25_000,
    } });
    expect(response.statusCode).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith("request_freelancer_service", { p_service_id: serviceId, p_input: expect.objectContaining({ budget_minor: "25000" }) });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("client_id");
  });

  it("rejects malformed draft milestone plans before reaching the database", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/draft-milestones`, headers: { authorization: "Bearer valid-token" }, payload: {
      milestones: [{ sequence: 1, title: "Build", description: "Implement the approved pages.", deliverables: ["Responsive pages"], acceptanceCriteria: ["Passes mobile review"], completionConditions: ["Client acceptance recorded"], amountMinor: 60_000.5, dueDate: null, dependencySequences: [] }],
    } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("persists a valid draft milestone plan as exact minor-unit text through the auth-bound RPC", async () => {
    const supabase = authenticatedFactory({ rpcData: { projectId, status: "draft", milestoneCount: 1, totalMinor: "60000" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/draft-milestones`, headers: { authorization: "Bearer valid-token" }, payload: {
      milestones: [{ sequence: 1, title: "Build", description: "Implement the approved pages.", deliverables: ["Responsive pages"], acceptanceCriteria: ["Passes mobile review"], completionConditions: ["Client acceptance recorded"], amountMinor: 60_000, dueDate: null, dependencySequences: [] }],
    } });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("save_draft_project_milestones", {
      p_project_id: projectId,
      p_milestones: [expect.objectContaining({ sequence: 1, amount_minor: "60000", completion_conditions: ["Client acceptance recorded"] })],
    });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("user_id");
  });

  it("returns participant booleans instead of exposing marketplace account UUIDs", async () => {
    const rows = {
      marketplace_offers_for_user: [{ id: "offer-1", proposal_id: "proposal-1", job_id: jobId, is_recipient: true, terms: "A complete written offer for the agreed service.", amount_minor: "25000", currency: "USD", timeline_days: 7, status: "sent", project_id: null, created_at: "2026-10-30T10:00:00Z", responded_at: null }],
      service_hiring_requests_for_user: [{ id: "request-1", service_id: serviceId, participant_role: "requester", request_text: "Please build a responsive product page and include a handover call.", budget_minor: "25000", currency: "USD", status: "submitted", created_at: "2026-10-30T10:00:00Z", responded_at: null }],
    };
    const supabase = authenticatedFactory({ rows });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const offers = await app.inject({ method: "GET", url: "/api/offers", headers: { authorization: "Bearer valid-token" } });
    const requests = await app.inject({ method: "GET", url: "/api/service-requests", headers: { authorization: "Bearer valid-token" } });
    expect(offers.json().offers[0].isRecipient).toBe(true);
    expect(requests.json().requests[0].participantRole).toBe("requester");
    expect(offers.body).not.toContain("client-private-id");
    expect(requests.body).not.toContain("provider-private-id");
  });

  it("returns the existing offer result on an authenticated idempotent retry", async () => {
    const supabase = authenticatedFactory({ rpcData: { offerId, status: "sent", projectId: null, alreadyCreated: true } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/proposals/${proposalId}/offers`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: "fe9dd2a8-095b-41a5-813b-a74aeb6b3875",
      terms: "A complete fictional offer with the agreed project scope and delivery terms.",
      amountMinor: 60_000,
      currency: "USD",
      timelineDays: 30,
    } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ offerId, status: "sent", projectId: null, alreadyCreated: true });
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.rpc).toHaveBeenCalledWith("create_marketplace_offer", {
      p_proposal_id: proposalId,
      p_input: {
        idempotency_key: "fe9dd2a8-095b-41a5-813b-a74aeb6b3875",
        terms: "A complete fictional offer with the agreed project scope and delivery terms.",
        amount_minor: "60000",
        currency: "USD",
        timeline_days: 30,
      },
    });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("client_id");
  });

  it("maps an offer idempotency conflict without exposing database details", async () => {
    const supabase = authenticatedFactory({ rpcError: { code: "23505", message: "private conflict details" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/proposals/${proposalId}/offers`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: "fe9dd2a8-095b-41a5-813b-a74aeb6b3875",
      terms: "A changed fictional offer with the same idempotency key.",
      amountMinor: 61_000,
      currency: "USD",
      timelineDays: 31,
    } });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain("private conflict details");
  });
});
