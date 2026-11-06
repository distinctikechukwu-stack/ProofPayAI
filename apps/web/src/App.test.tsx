import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

afterEach(() => vi.unstubAllGlobals());

describe("ProofPay AI product preview", () => {
  it("renders the public landing page and navigates into the demo workspace", async () => {
    const user = userEvent.setup();
    renderRoute("/");

    expect(await screen.findByRole("heading", { name: /good work starts with clear agreements/i }, { timeout: 10000 })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /explore the demo/i }));
    expect(await screen.findByRole("heading", { name: /your work, in good shape/i }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/sample workspace for the proofpay ai demo/i)).toBeInTheDocument();
  }, 20000);

  it("shows the illustrative agreement evidence and switches workspace role", async () => {
    const user = userEvent.setup();
    renderRoute("/app/scope");

    expect(await screen.findByRole("heading", { name: /review the request/i }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/scheduling, calendar integrations, and appointment booking are not included/i)).toBeInTheDocument();
    expect(screen.getByText(/no ai provider is connected/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /switch workspace role/i }));
    expect(screen.getByText("Client view")).toBeInTheDocument();
  }, 15000);

  it("filters the sample project list and recovers from an empty search", async () => {
    const user = userEvent.setup();
    renderRoute("/app/projects");
    expect(await screen.findByRole("link", { name: /studio website refresh/i })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /search projects/i }), "unknown project");
    expect(screen.getByText(/no matching sample projects/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByRole("link", { name: /studio website refresh/i })).toBeInTheDocument();
  });

  it("does not submit disabled credentials when Supabase Auth is unconfigured", async () => {
    const user = userEvent.setup();
    renderRoute("/signin");
    expect(await screen.findByText(/supabase auth is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /continue without an account/i }));
    expect(await screen.findByRole("heading", { name: /your work, in good shape/i })).toBeInTheDocument();
  });

  it("keeps analytics data unavailable until the user signs in", async () => {
    renderRoute("/app/analytics");

    expect(await screen.findByRole("heading", { name: "Analytics" }, { timeout: 10000 })).toBeInTheDocument();
    expect(await screen.findByText(/sign in to load project and invoice analytics/i)).toBeInTheDocument();
    expect(screen.queryByText(/no paid invoices/i)).not.toBeInTheDocument();
  }, 15000);

  it("shows the milestone schedule as clearly labeled sample data in demo mode", async () => {
    renderRoute("/app/timeline");

    expect(await screen.findByRole("heading", { name: "Timeline" }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/illustrative studio website refresh sample project/i)).toBeInTheDocument();
    expect(screen.getByText("Discovery & wireframes")).toBeInTheDocument();
    expect(screen.getByText("Build, QA & launch")).toBeInTheDocument();
  }, 15000);

  it("keeps invoice and payment records out of the signed-out Sandbox preview", async () => {
    renderRoute("/app/invoices");

    expect(await screen.findByRole("heading", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.getByText(/it illustrates the invoice flow/i)).toBeInTheDocument();
    expect(screen.getByText(/no invoice, provider link, or payment record exists/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create draft/i })).not.toBeInTheDocument();
  });

  it("keeps profile editing account-only in the sample workspace", async () => {
    renderRoute("/app/profile");

    expect(await screen.findByRole("heading", { name: "Profile & roles" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sign in to manage your profile/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /freelancer/i })).not.toBeInTheDocument();
  });

  it("does not present sample opportunity listings as live jobs while signed out", async () => {
    renderRoute("/app/opportunities");

    expect(await screen.findByRole("heading", { name: "Opportunities" }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sign in to browse persisted jobs/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sample job/i })).not.toBeInTheDocument();
  });

  it("keeps project conversations and notifications private while signed out", async () => {
    renderRoute("/app/messages");

    expect(await screen.findByRole("heading", { name: "Messages" }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /sign in to view project conversations/i })).toBeInTheDocument();
    expect(screen.getByText(/no sample conversations are displayed here/i)).toBeInTheDocument();
  }, 15000);

  it("does not show example time entries or controls in the signed-out hourly workspace", async () => {
    renderRoute("/app/projects/1319f6b9-8b9c-4138-8dd7-538b54b902f6/hourly");

    expect(await screen.findByRole("heading", { name: /sign in to open hourly project work/i }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start timer|add draft entry|approve time/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/illustrative sample time/i)).not.toBeInTheDocument();
  }, 15000);

  it("keeps moderation controls behind a signed-in administrator session", async () => {
    renderRoute("/app/moderation");

    expect(await screen.findByRole("heading", { name: /sign in to open administrator tools/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hide listing|restore listing|escalate|begin review/i })).not.toBeInTheDocument();
  });

  it("does not offer account deletion requests in the signed-out preview", async () => {
    renderRoute("/app/settings");

    expect(await screen.findByRole("heading", { name: "Settings" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/sign in to submit an account request/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /request deletion/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit deletion request/i })).not.toBeInTheDocument();
  });

  it("shows a public service from the public API without exposing private row fields", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ services: [{
      id: "b8bf1bf6-6d84-4acf-8851-e59e69ddd3d4", freelancerSlug: "jordan-rivera", freelancerName: "Jordan Rivera",
      slug: "accessible-page", title: "Accessible product landing page", description: "A responsive product landing page with clear keyboard navigation and a handover.",
      category: "Design", startingPriceMinor: "25000", currency: "USD", deliveryDays: 7, deliverables: ["Responsive landing page"],
      packages: [{ title: "Standard", description: "One page and a review round.", priceMinor: "25000", deliveryDays: 7, deliverables: ["Landing page"] }],
      ownerEmail: "release-test-user-001@example.invalid",
    }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    renderRoute("/app/services");

    expect(await screen.findByRole("heading", { name: "Accessible product landing page" }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/public services are opt-in listings/i)).toBeInTheDocument();
    expect(screen.queryByText(/release-test-user-001@example.invalid/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/services"), expect.objectContaining({ headers: { Accept: "application/json" } }));
  }, 15000);

  it("renders public freelancer cards from the public API projection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ profile: {
        slug: "jordan-rivera", displayName: "Jordan Rivera", avatarUrl: null, headline: "Product designer",
        biography: "I design accessible tools.", skills: ["Research", "Figma"], experienceSummary: "Eight years.",
        educationSummary: "Design studies.", languages: ["English"], category: "Design", hourlyRateMinor: "7500",
        currency: "USD", availability: "available", portfolio: [{
          title: "Transit planner", description: "A public case study.", projectUrl: "https://example.com/work", imageUrl: null, featured: true,
        }],
      } }),
    })));
    renderRoute("/freelancers/jordan-rivera");

    expect(await screen.findByRole("heading", { name: "Jordan Rivera" })).toBeInTheDocument();
    expect(screen.getByText("Product designer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transit planner" })).toBeInTheDocument();
    expect(screen.queryByText(/billing email|private@example/i)).not.toBeInTheDocument();
  });
});
