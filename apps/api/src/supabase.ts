import { createClient } from "@supabase/supabase-js";

export interface SupabasePort {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error: unknown | null;
    }>;
  };
  from(table: string): { select(columns: string): SupabaseQueryPort };
  rpc(name: string, args?: Record<string, unknown>): Promise<{
    data: unknown;
    error: unknown | null;
  }>;
}

export interface SupabaseQueryPort {
  limit(count: number): SupabaseQueryPort;
  order(column: string, options?: { ascending?: boolean }): Promise<{ data: unknown[] | null; error: unknown | null }>;
  eq(column: string, value: string): SupabaseQueryPort;
  maybeSingle(): Promise<{ data: unknown | null; error: unknown | null }>;
}

export type SupabaseFactory = (url: string, anonKey: string, token: string) => SupabasePort;
export type SupabasePublicFactory = (url: string, anonKey: string) => SupabasePort;
export type SupabaseAuditFactory = (url: string, serviceRoleKey: string) => SupabasePort;

export const createRequestSupabase: SupabaseFactory = (url, anonKey, token) =>
  createClient<any>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as SupabasePort;

export const createPublicSupabase: SupabasePublicFactory = (url, anonKey) =>
  createClient<any>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as SupabasePort;

export const createAuditSupabase: SupabaseAuditFactory = (url, serviceRoleKey) =>
  createClient<any>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as SupabasePort;
