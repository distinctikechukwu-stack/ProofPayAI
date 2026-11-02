import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OpportunitiesPage, type Proposal } from "./OpportunitiesPage";

const marketplaceStyles = readFileSync("src/styles/marketplace.css", "utf8");

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), user: { id: "client-test-account" } }));

vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../lib/api", () => ({ apiRequest: mocks.apiRequest, publicApiRequest: vi.fn() }));

const jobId = "00000000-0000-4000-8000-000000000001";
const otherJobId = "00000000-0000-4000-8000-000000000002";

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "proposal-1",
  jobId,
  isMine: false,
  coverLetter: "I will deliver the requested work with clear review milestones.",
  quoteMinor: "50000",
  currency: "USD",
  timelineDays: 12,
  portfolioItemIds: ["portfolio-reference-1"],
  status: "submitted",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

function renderMarketplace({
  roles = ["client"],
  isOwner = true,
  proposals = [
    makeProposal({ id: "proposal-1", quoteMinor: "50000", timelineDays: 12, status: "submitted", createdAt: "2026-11-01T10:00:00.000Z" }),
    makeProposal({ id: "proposal-2", quoteMinor: "30000", timelineDays: 8, status: "shortlisted", createdAt: "2026-11-01T09:00:00.000Z", coverLetter: "I can deliver this in a focused first release." }),
    makeProposal({ id: "proposal-3", quoteMinor: "90000", timelineDays: 20, status: "interview_invited", createdAt: "2026-11-01T08:00:00.000Z", coverLetter: "I will document the work and provide review checkpoints." }),
  ],
}: {
  roles?: string[];
  isOwner?: boolean;
  proposals?: Proposal[];
} = {}) {
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path === "/api/profile") return { roles, portfolio: [] };
    if (path === "/api/offers") return { offers: [] };
    if (path === `/api/jobs/${jobId}`) return { job: {
      id: jobId, isOwner, title: "Build a product site", summary: "A responsive product website for a new service.",
      description: "Create a polished website with accessible navigation and clear product information.", requirements: ["Responsive layout"], skills: ["React"],
      category: "Development", experienceLevel: "intermediate", projectType: "fixed", fixedBudgetMinor: "60000",
      hourlyRateMinMinor: null, hourlyRateMaxMinor: null, currency: "USD", estimatedDays: 30,
      status: "published", createdAt: "2026-10-30T10:00:00.000Z",
    } };
    if (path === `/api/jobs/${jobId}/proposals`) return { proposals };
    if (typeof path !== "string") return {};
    throw new Error("Unexpected API request: " + String(path) + "\n" + new Error().stack);
  });

  return render(<MemoryRouter initialEntries={[`/app/opportunities/${jobId}`]}>
    <Routes><Route path="/app/opportunities/:jobId" element={<OpportunitiesPage />} /></Routes>
  </MemoryRouter>);
}

describe("client proposal comparison", () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  it("compares selected proposals for the owned job while keeping hiring actions on the review cards", async () => {
    const user = userEvent.setup();
    renderMarketplace();

    expect(await screen.findByRole("heading", { name: "Proposal review" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));

    const comparison = await screen.findByRole("list", { name: "Selected proposals for comparison" });
    expect(within(comparison).getAllByRole("listitem")).toHaveLength(2);
    expect(within(comparison).getByText("$500.00 USD")).toBeInTheDocument();
    expect(within(comparison).getByText("12 days")).toBeInTheDocument();
    expect(within(comparison).getAllByText("submitted")).toHaveLength(2);
    expect(within(comparison).getByText("I will deliver the requested work with clear review milestones.")).toBeInTheDocument();
    expect(within(comparison).getAllByText(/1 attached; titles and details are not available/i)).toHaveLength(2);
    expect(within(comparison).queryByRole("button", { name: /shortlist/i })).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "Shortlist" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Mark interview requested" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /send offer/i })).toHaveLength(3);
  });

  it("sorts exact quote values and filters the same job's proposals by status", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByRole("heading", { name: "Proposal review" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort proposals" }), "quote_low");
    const proposalList = screen.getByRole("list", { name: "Proposals for this job" });
    const amounts = within(proposalList).getAllByText(/\$[\d,.]+ USD/).map((item) => item.textContent?.match(/\$[\d,.]+ USD/)?.[0]);
    expect(amounts).toEqual(["$300.00 USD", "$500.00 USD", "$900.00 USD"]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter proposals by status" }), "shortlisted");
    expect(within(proposalList).getAllByRole("listitem")).toHaveLength(1);
    expect(within(proposalList).getByText(/\$300\.00 USD · 8 days/)).toBeInTheDocument();
    expect(within(proposalList).queryByText(/\$500\.00 USD · 12 days/)).not.toBeInTheDocument();
  });

  it("labels unavailable proposal information and uses a narrow-screen stacked comparison layout", async () => {
    const user = userEvent.setup();
    const missing = makeProposal({
      id: "proposal-missing", quoteMinor: undefined as unknown as string, currency: undefined as unknown as string,
      timelineDays: undefined as unknown as number, coverLetter: "", portfolioItemIds: undefined as unknown as string[],
      createdAt: "2026-11-01T11:00:00.000Z",
    });
    renderMarketplace({ proposals: [missing, makeProposal({ id: "proposal-present" })] });

    expect(await screen.findByText(/Quote not provided · Timeline not provided/)).toBeInTheDocument();
    expect(screen.getByText(/Quote not provided · Timeline not provided/)).toBeInTheDocument();
    expect(screen.getByText("No cover letter provided.")).toBeInTheDocument();
    expect(screen.getByText("No portfolio references attached.")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));

    const comparison = await screen.findByRole("list", { name: "Selected proposals for comparison" });
    expect(within(comparison).getByText("Quote not provided")).toBeInTheDocument();
    expect(within(comparison).getByText("Timeline not provided")).toBeInTheDocument();
    expect(within(comparison).getByText("No cover letter provided.")).toBeInTheDocument();
    expect(within(comparison).getByText("No portfolio references attached.")).toBeInTheDocument();
    expect(comparison).toHaveClass("marketplace-comparison-grid");
    expect(marketplaceStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.marketplace-review-toolbar,\.marketplace-comparison-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it.each([
    { label: "a client who does not own the job", roles: ["client"], isOwner: false },
    { label: "a freelancer account viewing an owned listing", roles: ["freelancer"], isOwner: true },
  ])("does not expose review or comparison controls to $label", async ({ roles, isOwner }) => {
    renderMarketplace({ roles, isOwner, proposals: [makeProposal({ coverLetter: "Private application content." })] });

    expect(await screen.findByText("About this project")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Proposal review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /select proposal/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Private application content.")).not.toBeInTheDocument();
  });

  it("excludes proposals returned for a different job from the current comparison", async () => {
    const user = userEvent.setup();
    renderMarketplace({ proposals: [
      makeProposal({ id: "proposal-current" }),
      makeProposal({ id: "proposal-other-job", jobId: otherJobId, coverLetter: "A different client's private application." }),
    ] });

    expect(await screen.findByText("1 applicant")).toBeInTheDocument();
    expect(screen.queryByText("A different client's private application.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    expect(screen.queryByRole("list", { name: "Selected proposals for comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/select one more proposal/i)).toBeInTheDocument();
  });
});
