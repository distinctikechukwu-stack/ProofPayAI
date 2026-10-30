const apiBase = (import.meta.env.VITE_API_URL?.trim() || "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const { supabase } = await import("./supabase");
  if (!supabase) throw new ApiError("Supabase is not configured for this workspace.", 503);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError("Sign in to access project records.", 401);
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
      ? result.error
      : "The project service could not complete this request.";
    throw new ApiError(message, response.status);
  }
  return result as T;
}

export async function publicApiRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { signal, headers: { Accept: "application/json" } });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
      ? result.error
      : "The public profile could not be loaded.";
    throw new ApiError(message, response.status);
  }
  return result as T;
}
