import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallbackPage } from "./AuthCallbackPage";

const { authState } = vi.hoisted(() => ({ authState: { configured: true, loading: false, session: null as unknown } }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ ...authState, user: null, passwordRecovery: false, signIn: vi.fn(), signInWithGoogle: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), sendRecovery: vi.fn(), updatePassword: vi.fn() }) }));

function renderCallback(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route path="/app/profile" element={<div>Private profile setup</div>} />
    <Route path="/signin" element={<div>Sign-in page</div>} />
  </Routes></MemoryRouter>);
}

describe("OAuth callback", () => {
  beforeEach(() => { authState.configured = true; authState.loading = false; authState.session = null; });

  it("waits for Supabase session restoration before entering first-time profile setup", async () => {
    authState.loading = true;
    const view = renderCallback("/auth/callback");
    expect(screen.getByRole("status")).toHaveTextContent(/finishing secure sign-in/i);
    authState.loading = false;
    authState.session = { user: { id: "google-user" } };
    view.rerender(<MemoryRouter initialEntries={["/auth/callback"]}><Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/app/profile" element={<div>Private profile setup</div>} />
      <Route path="/signin" element={<div>Sign-in page</div>} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText("Private profile setup")).toBeInTheDocument();
  });

  it("does not enter private setup without a session and hides provider details", async () => {
    const privateDetail = "sensitive provider error detail";
    renderCallback(`/auth/callback?error=access_denied&error_description=${encodeURIComponent(privateDetail)}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/google did not complete the sign-in/i);
    expect(screen.queryByText("Private profile setup")).not.toBeInTheDocument();
    expect(screen.queryByText(privateDetail)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to sign in/i })).toHaveAttribute("href", "/signin");
  });
});
