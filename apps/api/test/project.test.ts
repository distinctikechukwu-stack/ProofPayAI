import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory, SupabasePort } from "../src/supabase.js";

const validDraft = {
  idempotencyKey: "296938c0-465f-4ab1-9d91-8aa68dae34de",
  title: "A small website",
  description: "Design and build a marketing site.",
  clientName: "Northstar Studio",
  budgetMinor: 60_000,
  currency: "USD",
  requirements: ["Responsive pages"],
  milestones: [{ sequence: 1, title: "Build", description: "Implement pages", deliverables: ["Pages"], acceptanceCriteria: ["Mobile layout"], completionConditions: ["Client review completed"], amountMinor: 60_000 }],
};

function factory(options: { authError?: unknown; rpcError?: unknown; rpcData?: unknown } = {}) {
  const rpc = vi.fn(async () => ({ data: options.rpcData ?? { projectId: "project-1" }, error: options.rpcError ?? null }));
  const order = vi.fn(async () => ({ data: [{ id: "project-1", title: "A small website" }], error: null }));
  const getUser = vi.fn(async () => ({ data: { user: options.authError ? null : { id: "user-1" } }, error: options.authError ?? null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        order: table === "projects" ? order : vi.fn(async () => ({ data: [], error: null })),
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [], error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    rpc,
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, client, rpc, order, getUser };
}

const scopeIds = {
  project: "94281c1c-16f7-48fa-947c-cf339c4ba3e9",
  request: "fdb2f3c1-f5f9-496e-9248-01494352c03d",
  agreement: "ef8ff98e-7227-4a9c-90fd-b19230f91ef4",
};

function scopeFactory(result: unknown, rpcData: unknown = { analysisId: "analysis-1", result }) {
  const rows: Record<string, unknown> = {
    change_requests: {
      id: scopeIds.request,
      project_id: scopeIds.project,
      based_on_agreement_version_id: scopeIds.agreement,
      request_text: "Please add a booking calendar.",
      status: "pending_analysis",
    },
    projects: { id: scopeIds.project, current_agreement_version_id: scopeIds.agreement },
    agreement_versions: {
      id: scopeIds.agreement,
      project_id: scopeIds.project,
      state: "accepted",
      scope_text: "Build a marketing site with five pages.",
      terms: { requirements: ["Responsive on mobile and desktop."] },
    },
    milestones: [{
      sequence: 1,
      title: "Build site",
      description: "Implement five pages.",
      deliverables: ["Responsive website"],
      acceptance_criteria: ["All five pages load"],
      completion_conditions: ["Client approves"],
    }],
    change_order_versions: [],
  };
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
        order: vi.fn(async () => ({ data: rows[table], error: null })),
      };
      return query;
    }),
    rpc,
  } as unknown as SupabasePort;
  return {
    create: vi.fn(() => client) as unknown as SupabaseFactory,
    createAudit: vi.fn(() => client),
    client,
    rpc,
  };
}

function analyticsFactory() {
  const rows: Record<string, unknown[]> = {
    projects: [{ id: "project-1", title: "Northstar website", status: "in_progress", budget_minor: "60000", currency: "USD", deadline: "2026-12-01", updated_at: "2026-10-29T12:00:00Z" }],
    milestones: [{ project_id: "project-1", workflow_status: "approved" }, { project_id: "project-1", workflow_status: "in_progress" }],
    invoices: [
      { id: "invoice-1", project_id: "project-1", provider_invoice_number: "PP-1", status: "paid", amount_minor: "25000", currency: "USD", created_at: "2026-10-25T12:00:00Z", paid_at: "2026-10-27T12:00:00Z" },
      { id: "invoice-2", project_id: "project-1", provider_invoice_number: "PP-2", status: "sent", amount_minor: "35000", currency: "USD", created_at: "2026-10-28T12:00:00Z", paid_at: null },
    ],
  };
  const getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({ order: vi.fn(async () => ({ data: rows[table] ?? [], error: null })) })),
    })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, client };
}

function timelineFactory() {
  const rows: Record<string, unknown[]> = {
    projects: [{ id: "project-1", title: "Northstar website", client_name: "Northstar Studio", status: "in_progress" }],
    milestones: [
      { id: "milestone-1", project_id: "project-1", sequence: 1, title: "Discovery", workflow_status: "approved", due_date: "2026-11-06", amount_minor: "15000", currency: "USD" },
      { id: "milestone-2", project_id: "hidden-project", sequence: 2, title: "Private milestone", workflow_status: "in_progress", due_date: "2026-11-16", amount_minor: "25000", currency: "USD" },
    ],
  };
  const getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({ order: vi.fn(async () => ({ data: rows[table] ?? [], error: null })) })),
    })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as SupabasePort;
  return { create: vi.fn(() => client) as unknown as SupabaseFactory, client };
}

const projectDetailIds = {
  project: "117a3dce-1981-4e85-ad72-34b236ff49ba",
  milestone: "1d8f102d-0716-42d2-8c8c-82d1838f8314",
  publicSubmission: "37df0650-a625-4d67-96be-57eaf4377794",
  privateSubmission: "e8492a47-326b-4a4e-93a4-c071cf6f8ed7",
  review: "d3fb1b75-c5e2-477d-93ca-127423203229",
};

function projectDetailFactory(options: { visibleProject?: boolean; userId?: string } = {}) {
  const records: Record<string, Array<Record<string, unknown>>> = {
    projects: [{
      id: projectDetailIds.project, created_by: "freelancer-user", title: "Fictional project", description: "Project description",
      client_name: "Fictional client", budget_minor: "60000", currency: "USD", contract_type: "fixed", deadline: null,
      status: "in_progress", current_agreement_version_id: "agreement-version", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-02T10:00:00Z",
    }],
    milestones: [{
      id: projectDetailIds.milestone, project_id: projectDetailIds.project, sequence: 1, title: "Milestone 1", description: "Build the first deliverable",
      deliverables: ["The first deliverable"], acceptance_criteria: ["Client review"], completion_conditions: ["Accepted"], amount_minor: "60000",
      currency: "USD", due_date: null, dependency_sequences: [], workflow_status: "revision_requested",
    }],
    agreement_versions: [], change_requests: [], ai_analysis_records: [], change_order_versions: [],
    deliverables: [
      { id: projectDetailIds.publicSubmission, project_id: projectDetailIds.project, milestone_id: projectDetailIds.milestone, description: "First work summary", evidence_url: "https://evidence.example.test/first", storage_object_path: null, created_at: "2026-11-04T10:00:00Z" },
      { id: projectDetailIds.privateSubmission, project_id: projectDetailIds.project, milestone_id: projectDetailIds.milestone, description: "Revised work summary", evidence_url: null, storage_object_path: `${projectDetailIds.project}/${projectDetailIds.milestone}/private-file.pdf`, created_at: "2026-11-04T11:00:00Z" },
    ],
    milestone_reviews: [{
      id: projectDetailIds.review, project_id: projectDetailIds.project, milestone_id: projectDetailIds.milestone,
      deliverable_id: projectDetailIds.publicSubmission, reviewed_by: "client-user", decision: "request_revision",
      note: "Please include the agreed mobile layout.", idempotency_key: "private-idempotency-key", created_at: "2026-11-04T10:30:00Z",
    }],
  };
  const filters = new Map<string, Array<{ column: string; value: unknown }>>();
  const selectedColumns = new Map<string, string>();
  const queriedTables: string[] = [];
  const getUser = vi.fn(async () => ({ data: { user: { id: options.userId ?? "client-user" } }, error: null }));
  const client = {
    auth: { getUser },
    from: vi.fn((table: string) => {
      queriedTables.push(table);
      const tableFilters: Array<{ column: string; value: unknown }> = [];
      filters.set(table, tableFilters);
      const matchingRows = () => (records[table] ?? []).filter((row) => tableFilters.every(({ column, value }) => row[column] === value));
      const query = {
        select: vi.fn((columns: string) => { selectedColumns.set(table, columns); return query; }),
        eq: vi.fn((column: string, value: unknown) => { tableFilters.push({ column, value }); return query; }),
        order: vi.fn(async () => ({ data: matchingRows(), error: null })),
        maybeSingle: vi.fn(async () => ({ data: table === "projects" && options.visibleProject === false ? null : matchingRows()[0] ?? null, error: null })),
      };
      return query;
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as SupabasePort;
  return {
    create: vi.fn(() => client) as unknown as SupabaseFactory,
    client,
    getUser,
    filters,
    selectedColumns,
    queriedTables,
  };
}

describe("authenticated project API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  it("returns 401 without a bearer session and 503 when Supabase is not configured", async () => {
    app = await buildApp({ logger: false, supabaseUrl: "", supabaseAnonKey: "" });
    const noToken = await app.inject({ method: "GET", url: "/api/projects" });
    const noConfig = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer test-token" } });
    expect(noToken.statusCode).toBe(401);
    expect(noConfig.statusCode).toBe(503);
    expect(noConfig.json().error).toContain("not configured");
  });

  it("does not report example placeholders as configured integrations", async () => {
    vi.stubEnv("SUPABASE_URL", "https://your-project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "your-supabase-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "your-supabase-service-role-key");
    vi.stubEnv("OPENAI_API_KEY", "your-openai-api-key");
    vi.stubEnv("OPENAI_MODEL", "your-supported-model");
    vi.stubEnv("PAYPAL_SANDBOX_CLIENT_ID", "your-sandbox-client-id");
    vi.stubEnv("PAYPAL_SANDBOX_CLIENT_SECRET", "your-sandbox-client-secret");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "your-sandbox-webhook-id");
    app = await buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/api/status" });
    expect(response.json().integrations).toEqual({ supabase: false, ai: false, aiAuditStorage: false, paypal: false, paypalWebhook: false });
  });

  it("validates project totals before any database write", async () => {
    const supabase = factory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: "/api/projects", headers: { authorization: "Bearer valid-token" },
      payload: { ...validDraft, budgetMinor: 60_001 },
    });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("maps a validated project draft into the guarded RPC and forwards only the user's JWT context", async () => {
    const supabase = factory({ rpcData: { projectId: "project-1", status: "draft" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: "/api/projects", headers: { authorization: "Bearer valid-token" }, payload: validDraft,
    });
    expect(response.statusCode).toBe(201);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.rpc).toHaveBeenCalledWith("create_project_draft", expect.objectContaining({
      p_project: expect.objectContaining({ budget_minor: 60_000, client_name: "Northstar Studio" }),
      p_milestones: [expect.objectContaining({ amount_minor: 60_000, acceptance_criteria: ["Mobile layout"], completion_conditions: ["Client review completed"] })],
    }));
  });

  it("returns only RLS-filtered projects and translates authorization failures safely", async () => {
    const supabase = factory({ rpcError: { code: "42501", message: "private database detail" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const list = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer valid-token" } });
    const denied = await app.inject({
      method: "POST", url: "/api/agreements/94281c1c-16f7-48fa-947c-cf339c4ba3e9/accept",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().projects).toHaveLength(1);
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain("private database detail");
  });

  it("forwards an authenticated hourly-agreement acceptance to the caller-scoped RPC", async () => {
    const agreementVersionId = "7c71f7dd-2006-4bf1-9fe5-8465e8069cb9";
    const supabase = factory({ rpcData: { state: "accepted", acceptedRoleCount: 2 } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: `/api/agreements/${agreementVersionId}/accept`, headers: { authorization: "Bearer valid-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "accepted", acceptedRoleCount: 2 });
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.rpc).toHaveBeenCalledWith("accept_agreement_version", { p_agreement_version_id: agreementVersionId });
  });

  it("keeps an unauthorized hourly-agreement acceptance denied without exposing PostgreSQL details", async () => {
    const agreementVersionId = "7c71f7dd-2006-4bf1-9fe5-8465e8069cb9";
    const supabase = factory({ rpcError: { code: "42501", message: "permission denied for table hourly_contracts" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST", url: `/api/agreements/${agreementVersionId}/accept`, headers: { authorization: "Bearer valid-token" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("You do not have access to perform this action.");
    expect(response.body).not.toContain("hourly_contracts");
    expect(supabase.rpc).toHaveBeenCalledWith("accept_agreement_version", { p_agreement_version_id: agreementVersionId });
  });

  it("aggregates only the authenticated user's persisted analytics with exact paid totals", async () => {
    const supabase = analyticsFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/analytics", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        projectCount: 1,
        activeProjectCount: 1,
        milestoneCount: 2,
        approvedMilestoneCount: 1,
        invoiceCount: 2,
        paidInvoiceCount: 1,
        paidTotals: [{ currency: "USD", amountMinor: "25000" }],
      },
      invoices: [
        { id: "invoice-1", projectTitle: "Northstar website", status: "paid", amountMinor: "25000" },
        { id: "invoice-2", projectTitle: "Northstar website", status: "sent", amountMinor: "35000" },
      ],
    });
  });

  it("returns only milestones joined to the signed-in user's RLS-visible projects", async () => {
    const supabase = timelineFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/timeline", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual([{
      projectId: "project-1",
      projectTitle: "Northstar website",
      clientName: "Northstar Studio",
      projectStatus: "in_progress",
      milestoneId: "milestone-1",
      sequence: 1,
      title: "Discovery",
      status: "approved",
      dueDate: "2026-11-06",
      amountMinor: "15000",
      currency: "USD",
    }]);
  });

  it("treats a project hidden by RLS as not found", async () => {
    const supabase = factory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "GET", url: "/api/projects/94281c1c-16f7-48fa-947c-cf339c4ba3e9",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("private database detail");
  });

  it("returns project-scoped deliverable summaries and review feedback to an authenticated project member", async () => {
    const supabase = projectDetailFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "GET", url: `/api/projects/${projectDetailIds.project}`,
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-token");
    expect(supabase.filters.get("deliverables")).toContainEqual({ column: "project_id", value: projectDetailIds.project });
    expect(supabase.filters.get("milestone_reviews")).toContainEqual({ column: "project_id", value: projectDetailIds.project });
    expect(response.json().deliverables).toEqual([
      {
        id: projectDetailIds.publicSubmission, milestone_id: projectDetailIds.milestone, description: "First work summary",
        evidence_url: "https://evidence.example.test/first", has_private_file: false, created_at: "2026-11-04T10:00:00Z",
      },
      {
        id: projectDetailIds.privateSubmission, milestone_id: projectDetailIds.milestone, description: "Revised work summary",
        evidence_url: null, has_private_file: true, created_at: "2026-11-04T11:00:00Z",
      },
    ]);
    expect(response.json().milestoneReviews).toEqual([{
      id: projectDetailIds.review, milestone_id: projectDetailIds.milestone, deliverable_id: projectDetailIds.publicSubmission,
      decision: "request_revision", note: "Please include the agreed mobile layout.", created_at: "2026-11-04T10:30:00Z",
    }]);
    expect(response.body).not.toContain("storage_object_path");
    expect(response.body).not.toContain(`${projectDetailIds.project}/${projectDetailIds.milestone}/private-file.pdf`);
    expect(response.body).not.toContain("private-idempotency-key");
    expect(supabase.selectedColumns.get("deliverables")).not.toContain("storage_object_path");
    expect(supabase.selectedColumns.get("deliverables")).not.toContain("idempotency_key");
    expect(supabase.selectedColumns.get("milestone_reviews")).not.toContain("idempotency_key");
  });

  it("does not disclose child evidence or review data when the requested project is hidden by RLS", async () => {
    const supabase = projectDetailFactory({ visibleProject: false, userId: "unrelated-user" });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "GET", url: `/api/projects/${projectDetailIds.project}`,
      headers: { authorization: "Bearer valid-unrelated-token" },
    });

    expect(response.statusCode).toBe(404);
    expect(supabase.getUser).toHaveBeenCalledWith("valid-unrelated-token");
    expect(response.body).not.toContain("First work summary");
    expect(response.body).not.toContain("Please include the agreed mobile layout.");
    expect(response.body).not.toContain("https://evidence.example.test/first");
    expect(supabase.queriedTables).toEqual(["projects"]);
  });

  it("returns schema-checked AI milestone drafts with server-calculated exact allocations", async () => {
    const supabase = factory();
    const generateAi = vi.fn(async () => ({
      rationale: "Separate design review from implementation and launch.",
      milestones: [
        { sequence: 1, title: "Design", description: "Approve the visual direction.", deliverables: ["Design file"], acceptanceCriteria: ["Client reviews each page"], completionConditions: ["Design approved"], allocationWeight: 1, suggestedDueInDays: null, dependencySequences: [] },
        { sequence: 2, title: "Build", description: "Implement the approved pages.", deliverables: ["Responsive pages"], acceptanceCriteria: ["Pages pass agreed review"], completionConditions: ["Client approves the completed site"], allocationWeight: 3, suggestedDueInDays: 30, dependencySequences: [1] },
      ],
    }));
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create, createAuditSupabaseClient: supabase.createAudit, generateAi });
    const response = await app.inject({
      method: "POST", url: "/api/ai/milestones", headers: { authorization: "Bearer valid-token" },
      payload: { projectTitle: "A small website", projectDescription: "Design and build a marketing site.", requirements: ["Responsive pages"], budgetMinor: 60_000, currency: "USD" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "draft_for_review", needsHumanReview: true, totalMinor: "60000" });
    expect(response.json().milestones.map((milestone: { amountMinor: number }) => milestone.amountMinor)).toEqual([15_000, 45_000]);
    expect(generateAi).toHaveBeenCalledWith(expect.objectContaining({ name: "proofpay_milestones" }));
  });

  it("stores evidence-checked scope analysis against the accepted version and marks it for human review", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
    const analysis = {
      classification: "outside_scope",
      summary: "The booking calendar is not included in the agreed pages.",
      concerns: [],
      affectedMilestoneSequences: [1],
      citations: [{ source: "agreement_scope", milestoneSequence: null, changeOrderVersionId: null, exactExcerpt: "five pages" }],
      proposedAmendment: {
        title: "Add booking calendar",
        description: "Add calendar booking functionality.",
        deliverables: ["Booking calendar"],
        openQuestions: ["Which calendar provider should be supported?"],
        amountDeltaMinor: null,
        scheduleDeltaDays: null,
        estimateExplanation: "Pricing and schedule require negotiation.",
      },
      uncertainty: "Confirm the required booking workflow.",
    };
    const supabase = scopeFactory(analysis);
    const generateAi = vi.fn(async () => analysis);
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create, createAuditSupabaseClient: supabase.createAudit, generateAi });
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${scopeIds.project}/scope-requests/${scopeIds.request}/analyze`,
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ analysisId: "analysis-1", analysis, needsHumanReview: true, requiresDualApprovalForAmendment: true });
    expect(supabase.rpc).toHaveBeenCalledWith("record_scope_analysis", expect.objectContaining({
      p_actor_id: "user-1",
      p_project_id: scopeIds.project,
      p_request_id: scopeIds.request,
      p_agreement_version_id: scopeIds.agreement,
      p_provider: "groq",
      p_model: "openai/gpt-oss-20b",
      p_result: analysis,
    }));
  });

  it("does not save scope analysis when the model invents a source excerpt", async () => {
    const analysis = {
      classification: "outside_scope",
      summary: "Add a calendar feature.",
      concerns: [],
      affectedMilestoneSequences: [],
      citations: [{ source: "agreement_scope", milestoneSequence: null, changeOrderVersionId: null, exactExcerpt: "weekly payroll automation" }],
      proposedAmendment: {
        title: "Calendar", description: "Calendar feature", deliverables: [], openQuestions: [],
        amountDeltaMinor: null, scheduleDeltaDays: null, estimateExplanation: "Requires negotiation.",
      },
      uncertainty: "Details are unclear.",
    };
    const supabase = scopeFactory(analysis);
    app = await buildApp({
      logger: false,
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-anon",
      createSupabaseClient: supabase.create,
      createAuditSupabaseClient: supabase.createAudit,
      generateAi: async () => analysis,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${scopeIds.project}/scope-requests/${scopeIds.request}/analyze`,
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).toContain("does not match the accepted project record");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("validates and forwards a freelancer amendment proposal to the guarded RPC", async () => {
    const supabase = factory({ rpcData: { changeOrderVersionId: "change-order-1", state: "awaiting_approval" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${scopeIds.project}/scope-requests/${scopeIds.request}/change-orders`,
      headers: { authorization: "Bearer valid-token" },
      payload: {
        idempotencyKey: "771da1d2-5f2c-4f61-a150-d3c7f55011e8",
        title: "Add booking calendar",
        description: "Add a client-facing booking calendar.",
        amountDeltaMinor: 25_000,
        scheduleDeltaDays: 7,
        deliverables: ["Booking calendar"],
        openQuestions: ["Which calendar provider should be used?"],
        analysisId: "0bbd062f-ea39-41ea-863e-0a32a4f910ac",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith("create_change_order_draft", expect.objectContaining({
      p_project_id: scopeIds.project,
      p_request_id: scopeIds.request,
      p_draft: expect.objectContaining({ amountDeltaMinor: 25_000, scheduleDeltaDays: 7 }),
    }));
  });

  it("rejects an empty amendment with no changes before reaching the database", async () => {
    const supabase = factory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${scopeIds.project}/scope-requests/${scopeIds.request}/change-orders`,
      headers: { authorization: "Bearer valid-token" },
      payload: {
        idempotencyKey: "771da1d2-5f2c-4f61-a150-d3c7f55011e8",
        title: "Empty amendment",
        description: "Nothing changes.",
        amountDeltaMinor: 0,
        scheduleDeltaDays: 0,
        deliverables: [],
        openQuestions: [],
        analysisId: "0bbd062f-ea39-41ea-863e-0a32a4f910ac",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("routes a client amendment decision through the role-checked RPC", async () => {
    const supabase = factory({ rpcData: { changeOrderVersionId: "change-order-1", state: "accepted" } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({
      method: "POST",
      url: "/api/change-orders/0bbd062f-ea39-41ea-863e-0a32a4f910ac/decision",
      headers: { authorization: "Bearer valid-token" },
      payload: { decision: "accept" },
    });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("decide_change_order", {
      p_change_order_version_id: "0bbd062f-ea39-41ea-863e-0a32a4f910ac",
      p_decision: "accept",
    });
  });
});
