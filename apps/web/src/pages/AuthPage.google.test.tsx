import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPage } from "./AuthPage";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    configured: true,
    loading: false,
    signIn: vi.fn(async () => ({ error: null })),
    signInWithGoogle: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ error: null, needsEmailVerification: false })),
  },
}));

vi.mock("../contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

describe("Google sign-in on the email auth pages", () => {
  beforeEach(() => {
    mockAuth.configured = true;
    mockAuth.signInWithGoogle.mockClear();
  });

  it.each([
    ["signin", "Welcome back"],
    ["signup", "Create your account"],
  ] as const)("keeps email auth and offers Google on %s", async (mode, heading) => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[mode === "signin" ? "/signin" : "/signup"]}><AuthPage mode={mode} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    if (mode === "signup") expect(screen.getByRole("textbox", { name: /full name/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(mockAuth.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it("hides Google authentication when Supabase is not configured", () => {
    mockAuth.configured = false;
    render(<MemoryRouter initialEntries={["/signin"]}><AuthPage mode="signin" /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /continue with google/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeDisabled();
  });
});
