import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory, SupabasePort, SupabasePublicFactory } from "../src/supabase.js";

const savedProfile = {
  displayName: "Jordan Rivera", avatarUrl: null, publicSlug: "jordan-rivera", headline: "Product designer",
  biography: "I design accessible tools.", skills: ["Research", "Figma"], experienceSummary: "Eight years.", educationSummary: "Design studies.",
  languages: ["English"], category: "Design", hourlyRateMinor: 7500, currency: "USD", availability: "available", isPublic: true,
  portfolio: [{ title: "Transit planner", description: "A public case study.", projectUrl: "https://example.com/work", imageUrl: null, featured: true }],
};

function profileFactory(options: { rpcData?: unknown; rpcError?: unknown } = {}) {
  const records: Record<string, unknown> = {
    profiles: { id: "owner-1", display_name: "Jordan Rivera", avatar_url: null, email: "release-test-user-004@example.invalid" },
    profile_roles: [{ role: "freelancer" }, { role: "client" }],
    freelancer_profiles: { public_slug: "jordan-rivera", hourly_rate_minor: "7500", currency: "USD", is_public: true },
    client_profiles: { account_type: "business", organization_name: "Northstar", billing_email: "release-test-user-005@example.invalid" },
    freelancer_portfolio_items: [{ title: "Transit planner", position: 0 }],
  };
  const rpc = vi.fn(async () => ({ data: options.rpcData ?? true, error: options.rpcError ?? null }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "owner-1" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: records[table] ?? null, error: null })),
        order: vi.fn(async () => ({ data: Array.isArray(records[table]) ? records[table] : [], error: null })),
      };
      return query;
    }),
    rpc,
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, client, rpc, getUser };
}

function authFailureFactory(status: number, code: string) {
  const getUser = vi.fn(async () => ({ data: { user: null }, error: { status, code } }));
  const create = vi.fn(() => ({ auth: { getUser } }) as unknown as SupabasePort) as unknown as SupabaseFactory;
  return { create, getUser };
}

describe("marketplace profile API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("returns authenticated profile records without using any client-supplied account ID", async () => {
    const supabase = profileFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(response.json().account.id).toBe("owner-1");
    expect(response.json().roles).toEqual(["freelancer", "client"]);
    expect(response.json().client.billing_email).toBe("release-test-user-005@example.invalid");
    expect(response.body).not.toContain("email\":\"release-test-user-004@example.invalid");
  });

  it("requires a bearer token before creating a request-scoped Supabase client", async () => {
    const create = vi.fn() as unknown as SupabaseFactory;
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: create });
    const response = await app.inject({ method: "GET", url: "/api/profile" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Sign in to continue." });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an invalid token when Supabase Auth rejects it", async () => {
    const supabase = authFailureFactory(401, "bad_jwt");
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: "Bearer invalid-token" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Your session is invalid or expired." });
    expect(supabase.getUser).toHaveBeenCalledWith("invalid-token");
    expect(response.body).not.toContain("bad_jwt");
  });

  it("rejects an expired session when Supabase Auth reports token expiry", async () => {
    const supabase = authFailureFactory(401, "token_expired");
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: "Bearer expired-session" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Your session is invalid or expired." });
    expect(supabase.getUser).toHaveBeenCalledWith("expired-session");
    expect(response.body).not.toContain("token_expired");
  });

  it("reports Supabase transport failures as unavailable instead of invalid credentials", async () => {
    const supabase = authFailureFactory(0, "network_error");
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/profile", headers: { authorization: "Bearer valid-format-token" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Supabase authentication is temporarily unavailable." });
    expect(response.body).not.toContain("network_error");
  });

  it("prevents self-assignment of admin roles and validates before the database RPC", async () => {
    const supabase = profileFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: "/api/profile/roles", headers: { authorization: "Bearer valid-token" }, payload: { roles: ["admin"] } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends only validated role choices to the auth.uid-based role function", async () => {
    const supabase = profileFactory({ rpcData: ["client", "freelancer"] });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: "/api/profile/roles", headers: { authorization: "Bearer valid-token" }, payload: { roles: ["client", "freelancer"] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().roles).toEqual(["client", "freelancer"]);
    expect(supabase.rpc).toHaveBeenCalledWith("set_my_marketplace_roles", { p_roles: ["client", "freelancer"] });
  });

  it("validates freelancer input and stores the rate as exact integer minor units", async () => {
    const supabase = profileFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const invalid = await app.inject({ method: "POST", url: "/api/profile/freelancer", headers: { authorization: "Bearer valid-token" }, payload: { ...savedProfile, userId: "someone-else" } });
    expect(invalid.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
    const response = await app.inject({ method: "POST", url: "/api/profile/freelancer", headers: { authorization: "Bearer valid-token" }, payload: savedProfile });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("save_my_freelancer_profile", expect.objectContaining({
      p_profile: expect.objectContaining({ public_slug: "jordan-rivera", hourly_rate_minor: "7500", is_public: true }),
      p_portfolio: [expect.objectContaining({ project_url: "https://example.com/work" })],
    }));
  });

  it("stores client billing preferences through a private auth.uid-based RPC", async () => {
    const supabase = profileFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: "/api/profile/client", headers: { authorization: "Bearer valid-token" },
      payload: { accountType: "business", organizationName: "Northstar", organizationDescription: "Independent design studio.", websiteUrl: "https://northstar.example", billingEmail: "release-test-user-006@example.invalid" },
    });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("save_my_client_profile", { p_profile: {
      account_type: "business", organization_name: "Northstar", organization_description: "Independent design studio.",
      website_url: "https://northstar.example", billing_email: "release-test-user-006@example.invalid",
    } });
  });

  it("serves only the safe projection from the public-profile view without a user session", async () => {
    const data = {
      slug: "jordan-rivera", display_name: "Jordan Rivera", avatar_url: null, headline: "Product designer", biography: "Public bio",
      skills: ["Research"], experience_summary: "", education_summary: "", languages: [], category: "Design",
      hourly_rate_minor: "7500", currency: "USD", availability: "available", portfolio: [],
      email: "release-test-user-001@example.invalid", billing_email: "release-test-user-007@example.invalid", role: "admin",
    };
    const maybeSingle = vi.fn(async () => ({ data, error: null }));
    const publicClient = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })) } as unknown as SupabasePort;
    const createPublic = vi.fn(() => publicClient) as unknown as SupabasePublicFactory;
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createPublicSupabaseClient: createPublic });
    const response = await app.inject({ method: "GET", url: "/api/public/freelancers/jordan-rivera" });
    expect(response.statusCode).toBe(200);
    expect(createPublic).toHaveBeenCalledWith("https://example.supabase.co", "public-anon");
    expect(response.json().profile).toMatchObject({ slug: "jordan-rivera", hourlyRateMinor: "7500" });
    expect(response.body).not.toContain("release-test-user-001@example.invalid");
    expect(response.body).not.toContain("release-test-user-007@example.invalid");
    expect(response.body).not.toContain("admin");
  });

  it("does not disclose an unpublished profile and translates private database details", async () => {
    const publicClient = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) })) })) })) } as unknown as SupabasePort;
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createPublicSupabaseClient: () => publicClient });
    const response = await app.inject({ method: "GET", url: "/api/public/freelancers/private-slug" });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("billing");
  });

  it("does not call Supabase when the public API configuration contains placeholders", async () => {
    const createPublic = vi.fn(() => { throw new Error("must not initialize a placeholder client"); }) as unknown as SupabasePublicFactory;
    app = await buildApp({ logger: false, supabaseUrl: "https://your-project.supabase.co", supabaseAnonKey: "your-supabase-anon-key", createPublicSupabaseClient: createPublic });
    const response = await app.inject({ method: "GET", url: "/api/public/freelancers/jordan-rivera" });
    expect(response.statusCode).toBe(503);
    expect(createPublic).not.toHaveBeenCalled();
  });
});
