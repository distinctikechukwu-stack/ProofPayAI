import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory, SupabasePort } from "../src/supabase.js";

const conversationId = "3f1c7828-f1dc-48b5-b7a8-60dbcd59bc76";
const projectId = "cf612978-5aac-4ec9-b966-3fd46ad41255";
const notificationId = "acafad87-1595-48e6-9d58-2e29b40b3d18";
const messageId = "b6c8ad9c-18d0-43d8-9326-eaa18943c519";

function authenticatedFactory(options: { rows?: Record<string, unknown[]>; rpcData?: unknown } = {}) {
  const rpc = vi.fn(async () => ({ data: options.rpcData ?? { saved: true }, error: null }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "private-auth-user" } }, error: null }));
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

describe("project messaging API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("rejects empty messages before the database RPC", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: "4a1ef4cb-86ec-4ef7-80ba-a8cc8079f533", body: "  ", attachments: [],
    } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends a validated message through the auth-bound participant RPC", async () => {
    const supabase = authenticatedFactory({ rpcData: { messageId, alreadyCreated: false } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: "4a1ef4cb-86ec-4ef7-80ba-a8cc8079f533", body: "I uploaded the revised design.", attachments: [],
    } });
    expect(response.statusCode).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith("send_project_message", {
      p_conversation_id: conversationId,
      p_input: { idempotencyKey: "4a1ef4cb-86ec-4ef7-80ba-a8cc8079f533", body: "I uploaded the revised design.", attachments: [] },
    });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("private-auth-user");
  });

  it("rejects client-supplied participant identities", async () => {
    const supabase = authenticatedFactory();
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/conversations/${conversationId}/messages`, headers: { authorization: "Bearer valid-token" }, payload: {
      idempotencyKey: "4a1ef4cb-86ec-4ef7-80ba-a8cc8079f533", body: "Hello.", attachments: [], clientUserId: "untrusted-user-id",
    } });
    expect(response.statusCode).toBe(422);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("creates the project conversation using a requested project key and auth-bound membership check", async () => {
    const supabase = authenticatedFactory({ rpcData: { conversationId } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: "/api/conversations", headers: { authorization: "Bearer valid-token" }, payload: { projectId } });
    expect(response.statusCode).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith("create_project_conversation", { p_project_id: projectId });
    expect(JSON.stringify(supabase.rpc.mock.calls[0]?.[1])).not.toContain("user_id");
  });

  it("projects message history without sender UUIDs or idempotency internals", async () => {
    const rows = {
      project_messages_for_user: [{ id: messageId, conversation_id: conversationId, body: "Reviewed the checklist.", attachments: [], created_at: "2026-10-30T10:00:00Z", is_mine: false, sender_display_name: "Project member", read_by_other: false, sender_id: "private-auth-user", idempotency_key: "hidden-key", request_hash: "hidden-hash" }],
    };
    const supabase = authenticatedFactory({ rows });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: `/api/conversations/${conversationId}/messages`, headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().messages[0]).toMatchObject({ id: messageId, body: "Reviewed the checklist.", senderDisplayName: "Project member", isMine: false });
    expect(response.body).not.toContain("private-auth-user");
    expect(response.body).not.toContain("idempotency_key");
    expect(response.body).not.toContain("request_hash");
  });

  it("filters unread notifications and omits participant identifiers", async () => {
    const rows = {
      user_notifications_for_user: [
        { id: notificationId, conversation_id: conversationId, project_id: projectId, project_title: "Website refresh", actor_display_name: "Client", message_preview: "Could we review the next draft?", created_at: "2026-10-30T10:00:00Z", read_at: null, user_id: "private-auth-user", actor_id: "private-other-user" },
        { id: "67c99a37-89dc-4cc2-858c-c4147334191d", conversation_id: conversationId, project_id: projectId, project_title: "Website refresh", actor_display_name: "Client", message_preview: "Thanks.", created_at: "2026-10-29T10:00:00Z", read_at: "2026-10-29T10:10:00Z" },
      ],
    };
    const supabase = authenticatedFactory({ rows, rpcData: 3 });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "GET", url: "/api/notifications?unreadOnly=true", headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().notifications).toHaveLength(1);
    expect(response.json().unreadCount).toBe(3);
    expect(response.json().notifications[0]).toMatchObject({ id: notificationId, projectTitle: "Website refresh", actorDisplayName: "Client", readAt: null });
    expect(response.body).not.toContain("private-auth-user");
    expect(response.body).not.toContain("private-other-user");
  });

  it("marks notifications read through the actor-derived RPC", async () => {
    const supabase = authenticatedFactory({ rpcData: { notificationId, read: true } });
    app = await buildApp({ logger: false, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", createSupabaseClient: supabase.create });
    const response = await app.inject({ method: "POST", url: `/api/notifications/${notificationId}/read`, headers: { authorization: "Bearer valid-token" } });
    expect(response.statusCode).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("mark_user_notification_read", { p_notification_id: notificationId });
  });
});
