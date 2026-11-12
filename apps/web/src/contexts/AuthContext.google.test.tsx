import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { provider: "google", url: "https://accounts.google.com/" }, error: null })),
  },
}));

vi.mock("../lib/supabase", () => ({ supabase: { auth } }));

describe("Google OAuth auth action", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-value");
    auth.onAuthStateChange.mockClear();
    auth.getSession.mockClear();
    auth.signInWithOAuth.mockReset();
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "https://accounts.google.com/" }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("starts Google sign-in with the current app callback and basic identity scopes", async () => {
    vi.resetModules();
    const { AuthProvider, useAuth } = await import("./AuthContext");
    function Probe() {
      const authContext = useAuth();
      return <button type="button" onClick={() => void authContext.signInWithGoogle()}>Start Google</button>;
    }
    const user = userEvent.setup();
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "Start Google" }));

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "openid email profile",
      },
    });
  });

  it("returns a fixed safe error for provider rejection or transport exceptions", async () => {
    const privateProviderDetail = "sensitive provider error detail";
    auth.signInWithOAuth.mockResolvedValueOnce({ data: { provider: "google", url: "https://accounts.google.com/" }, error: { message: privateProviderDetail } as never });
    vi.resetModules();
    const { AuthProvider, useAuth } = await import("./AuthContext");
    let result: { error: string | null } | undefined;
    function Probe() {
      const authContext = useAuth();
      return <button type="button" onClick={async () => { result = await authContext.signInWithGoogle(); }}>Start Google</button>;
    }
    const user = userEvent.setup();
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    await user.click(await screen.findByRole("button", { name: "Start Google" }));
    await waitFor(() => expect(result?.error).toBe("Google sign-in could not be started. Please try again."));
    expect(result?.error).not.toContain(privateProviderDetail);

    auth.signInWithOAuth.mockRejectedValueOnce(new Error(privateProviderDetail));
    await user.click(await screen.findByRole("button", { name: "Start Google" }));
    await waitFor(() => expect(result?.error).toBe("Google sign-in could not be started. Please try again."));
    expect(result?.error).not.toContain(privateProviderDetail);
  });
});
