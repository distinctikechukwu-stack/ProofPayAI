import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OpportunitiesPage, type Proposal } from "./OpportunitiesPage";

const marketplaceStyles = readFileSync("src/styles/marketplace.css", "utf8");

function installLocalStorage() {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(String(key)) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => { entries.delete(String(key)); },
    setItem: (key, value) => { entries.set(String(key), String(value)); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), user: { id: "client-test-account" } }));

vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../lib/api", () => ({ apiRequest: mocks.apiRequest, publicApiRequest: vi.fn() }));

const jobId = "00000000-0000-4000-8000-000000000001";
const otherJobId = "00000000-0000-4000-8000-000000000002";
const portfolioItemId = "10000000-0000-4000-8000-000000000001";

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
  proposalLoader = async () => ({ proposals }),
  portfolio = [],
  apiOverride,
}: {
  roles?: string[];
  isOwner?: boolean;
  proposals?: Proposal[];
  proposalLoader?: () => Promise<{ proposals: Proposal[] }>;
  portfolio?: { id: string; title: string }[];
  apiOverride?: (path: string, options?: { method?: string; body?: unknown }) => unknown | undefined | Promise<unknown | undefined>;
} = {}) {
  mocks.apiRequest.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (apiOverride) {
      const overridden = await apiOverride(path, options);
      if (overridden !== undefined) return overridden;
    }
    if (path === "/api/profile") return { roles, portfolio };
    if (path === "/api/offers") return { offers: [] };
    if (path === `/api/jobs/${jobId}`) return { job: {
      id: jobId, isOwner, title: "Build a product site", summary: "A responsive product website for a new service.",
      description: "Create a polished website with accessible navigation and clear product information.", requirements: ["Responsive layout"], skills: ["React"],
      category: "Development", experienceLevel: "intermediate", projectType: "fixed", fixedBudgetMinor: "60000",
      hourlyRateMinMinor: null, hourlyRateMaxMinor: null, currency: "USD", estimatedDays: 30,
      status: "published", createdAt: "2026-10-30T10:00:00.000Z",
    } };
    if (path === `/api/jobs/${jobId}/proposals` && options?.method === "POST") return { proposalId: "proposal-created" };
    if (path === `/api/jobs/${jobId}/proposals`) return proposalLoader();
    if (typeof path === "string" && path.startsWith("/api/proposals/") && path.endsWith("/transition")) return {};
    if (typeof path !== "string") return {};
    throw new Error("Unexpected API request: " + String(path) + "\n" + new Error().stack);
  });

  return render(<MemoryRouter initialEntries={[`/app/opportunities/${jobId}`]}>
    <Routes><Route path="/app/opportunities/:jobId" element={<OpportunitiesPage />} /></Routes>
  </MemoryRouter>);
}

describe("client proposal comparison", () => {
  beforeEach(() => { vi.restoreAllMocks(); installLocalStorage(); mocks.apiRequest.mockReset(); mocks.user = { id: "client-test-account" }; });

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
    expect(within(comparison).getAllByText(/1 attached; titles and links are not available in this view\./i)).toHaveLength(2);
    expect(within(comparison).queryByRole("button", { name: /shortlist/i })).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "Shortlist" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Mark interview requested" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /send offer/i })).toHaveLength(3);
  });

  it("prints only selected proposals from this owned job after an explicit action without making API requests", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderMarketplace({ proposals: [
      makeProposal({ id: "proposal-print-one", coverLetter: "Selected proposal one exact cover letter.", createdAt: "2026-11-03T12:00:00.000Z" }),
      makeProposal({ id: "proposal-print-two", coverLetter: "Selected proposal two exact cover letter.", createdAt: "2026-11-03T11:00:00.000Z" }),
      makeProposal({ id: "proposal-print-unselected", coverLetter: "This unselected private application must not print.", createdAt: "2026-11-03T10:00:00.000Z" }),
      makeProposal({ id: "proposal-print-other-job", jobId: otherJobId, coverLetter: "This other job's private application must not print." }),
    ] });

    await screen.findByRole("heading", { name: "Proposal review" });
    expect(screen.queryByRole("button", { name: "Print comparison" })).not.toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));

    const printButton = screen.getByRole("button", { name: "Print comparison" });
    expect(printButton).toHaveAccessibleDescription("Print the selected proposals only. Use your browser dialog to print or save as PDF.");
    expect(print).not.toHaveBeenCalled();
    const apiCallsBeforePrint = mocks.apiRequest.mock.calls.length;
    const printDocument = document.body.querySelector(".marketplace-comparison-print-document");
    expect(printDocument).not.toBeNull();
    expect(printDocument).toHaveAttribute("aria-hidden", "true");
    expect(printDocument?.querySelectorAll(".marketplace-comparison-print-card")).toHaveLength(2);
    expect(printDocument).toHaveTextContent("$500.00 USD");
    expect(printDocument).toHaveTextContent("12 days");
    expect(printDocument).toHaveTextContent("submitted");
    expect(printDocument).toHaveTextContent("1 attached; titles and links are not available in this view.");
    expect(printDocument).toHaveTextContent("Selected proposal one exact cover letter.");
    expect(printDocument).toHaveTextContent("Selected proposal two exact cover letter.");
    expect(printDocument).not.toHaveTextContent("This unselected private application must not print.");
    expect(printDocument).not.toHaveTextContent("This other job's private application must not print.");
    expect(printDocument).not.toHaveTextContent("proposal-print-one");
    expect(printDocument?.querySelector("button, a, input, select, textarea")).toBeNull();

    await user.click(printButton);
    expect(print).toHaveBeenCalledTimes(1);
    expect(mocks.apiRequest.mock.calls).toHaveLength(apiCallsBeforePrint);
  });

  it("prints clear labels for incomplete proposal data and distinguishes missing portfolio details", async () => {
    const user = userEvent.setup();
    const missing = makeProposal({
      id: "proposal-print-missing", quoteMinor: undefined as unknown as string, currency: undefined as unknown as string,
      timelineDays: undefined as unknown as number, status: undefined as unknown as string,
      coverLetter: "", portfolioItemIds: undefined as unknown as string[],
    });
    const noReferences = makeProposal({
      id: "proposal-print-empty-references", quoteMinor: "30000", currency: "USD", timelineDays: 9,
      status: "", coverLetter: " ", portfolioItemIds: [],
    });
    renderMarketplace({ proposals: [missing, noReferences] });
    await screen.findByRole("heading", { name: "Proposal review" });
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));

    const printDocument = document.body.querySelector(".marketplace-comparison-print-document");
    expect(printDocument).toHaveTextContent("Quote not provided");
    expect(printDocument).toHaveTextContent("Timeline not provided");
    expect(printDocument).toHaveTextContent("Status not provided");
    expect(printDocument).toHaveTextContent("No cover letter provided.");
    expect(printDocument).toHaveTextContent("Portfolio reference information not provided.");
    expect(printDocument).toHaveTextContent("No portfolio references attached.");
  });

  it("prints only a clearly labeled excerpt when a cover letter is long", async () => {
    const user = userEvent.setup();
    const letter = `${"A detailed proposal statement. ".repeat(30)}PRIVATE TAIL SHOULD NOT BE PRINTED`;
    renderMarketplace({ proposals: [
      makeProposal({ id: "proposal-long-letter", coverLetter: letter, createdAt: "2026-11-03T12:00:00.000Z" }),
      makeProposal({ id: "proposal-second-long-letter", coverLetter: "A second selected proposal with its own details." }),
    ] });
    await screen.findByRole("heading", { name: "Proposal review" });
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));

    const printDocument = document.body.querySelector(".marketplace-comparison-print-document");
    expect(printDocument).toHaveTextContent("Cover-letter summary");
    expect(printDocument).toHaveTextContent("Excerpt only. Open the proposal in ProofPay AI to read the full cover letter.");
    expect(printDocument).not.toHaveTextContent("PRIVATE TAIL SHOULD NOT BE PRINTED");
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
    expect(screen.getByText("Portfolio reference information not provided.")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));

    const comparison = await screen.findByRole("list", { name: "Selected proposals for comparison" });
    expect(within(comparison).getByText("Quote not provided")).toBeInTheDocument();
    expect(within(comparison).getByText("Timeline not provided")).toBeInTheDocument();
    expect(within(comparison).getByText("No cover letter provided.")).toBeInTheDocument();
    expect(within(comparison).getByText("Portfolio reference information not provided.")).toBeInTheDocument();
    expect(comparison).toHaveClass("marketplace-comparison-grid");
    expect(marketplaceStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.marketplace-review-toolbar,\.marketplace-comparison-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(marketplaceStyles).toMatch(/\.marketplace-review-toolbar select \{\s*min-height:44px; font-size:12px;/);
    expect(marketplaceStyles).toMatch(/\.marketplace-review-toolbar select:focus-visible[\s\S]*outline:3px solid/);
    expect(marketplaceStyles).toMatch(/\.marketplace-proposal-select-row label \{ min-height:44px;/);
    expect(marketplaceStyles).toContain(".marketplace-comparison-print-document { display:none; }");
    expect(marketplaceStyles).toMatch(/@media print[\s\S]*?body > :not\(\.marketplace-comparison-print-document\) \{ display:none!important; \}/);
    expect(marketplaceStyles).toMatch(/break-inside:avoid-page; page-break-inside:avoid;/);
    expect(marketplaceStyles).toMatch(/@media print and \(orientation:portrait\)[\s\S]*?\.marketplace-comparison-print-grid \{ grid-template-columns:1fr; \}/);
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

  it("keeps selected proposals through sorting and filtering and supports both deselection controls", async () => {
    const user = userEvent.setup();
    renderMarketplace();
    await screen.findByRole("heading", { name: "Proposal review" });

    await user.click(screen.getByRole("checkbox", { name: "Select proposal 1 for comparison" }));
    await user.click(screen.getByRole("checkbox", { name: "Select proposal 2 for comparison" }));
    expect(screen.getByRole("link", { name: "Jump to comparison" })).toHaveAttribute("href", "#proposal-comparison-heading");

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort proposals" }), "quote_low");
    const proposalList = screen.getByRole("list", { name: "Proposals for this job" });
    expect(within(proposalList).getAllByRole("checkbox").filter((checkbox) => (checkbox as HTMLInputElement).checked)).toHaveLength(2);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter proposals by status" }), "shortlisted");
    expect(within(proposalList).getAllByRole("listitem")).toHaveLength(1);
    expect(within(proposalList).getByRole("checkbox", { name: "Remove proposal 2 for comparison" })).toBeChecked();
    expect(within(screen.getByRole("list", { name: "Selected proposals for comparison" })).getAllByRole("listitem")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Remove selected proposal 1" }));
    expect(screen.getByText(/1 of 4 selected for comparison/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Selected proposals for comparison" })).not.toBeInTheDocument();
    expect(within(proposalList).getByRole("checkbox", { name: "Remove proposal 2 for comparison" })).toBeChecked();

    await user.click(within(proposalList).getByRole("checkbox", { name: "Remove proposal 2 for comparison" }));
    expect(screen.getByText(/0 of 4 selected for comparison/)).toBeInTheDocument();
    expect(within(proposalList).getByRole("checkbox", { name: "Select proposal 2 for comparison" })).not.toBeChecked();
    expect(screen.queryByRole("link", { name: "Jump to comparison" })).not.toBeInTheDocument();
  });

  it("supports tab and space selection, explains the four-proposal limit, and keeps selected rows removable", async () => {
    const user = userEvent.setup();
    const proposals = Array.from({ length: 5 }, (_, index) => makeProposal({
      id: "proposal-limit-" + index,
      quoteMinor: String(10000 + index * 1000),
    }));
    renderMarketplace({ proposals });
    await screen.findByRole("heading", { name: "Proposal review" });

    screen.getByRole("link", { name: "Back to opportunities" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close applications" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Filter proposals by status" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Sort proposals" })).toHaveFocus();
    await user.tab();

    const proposalList = screen.getByRole("list", { name: "Proposals for this job" });
    const first = within(proposalList).getByRole("checkbox", { name: "Select proposal 1 for comparison" });
    expect(first).toHaveFocus();
    await user.keyboard(" ");
    expect(first).toBeChecked();
    await user.click(within(proposalList).getByRole("checkbox", { name: "Select proposal 2 for comparison" }));
    await user.click(within(proposalList).getByRole("checkbox", { name: "Select proposal 3 for comparison" }));
    await user.click(within(proposalList).getByRole("checkbox", { name: "Select proposal 4 for comparison" }));

    expect(screen.getByText(/4 of 4 selected for comparison/)).toBeInTheDocument();
    expect(screen.getByText(/Limit reached\. Remove a selected proposal before adding another\./)).toBeInTheDocument();
    const fifth = within(proposalList).getByRole("checkbox", { name: "Select proposal 5 for comparison" });
    expect(fifth).toBeDisabled();
    expect(fifth).toHaveAttribute("aria-describedby", "proposal-comparison-limit");
    expect(within(proposalList).getByRole("checkbox", { name: "Remove proposal 1 for comparison" })).toBeEnabled();
  });

  it("announces loading, hides stale proposal data after a failed reload, and supports retry", async () => {
    const user = userEvent.setup();
    const proposal = makeProposal({ coverLetter: "Private proposal content for reload recovery." });
    let loadCount = 0;
    let resolveInitial: ((value: { proposals: Proposal[] }) => void) | undefined;
    const proposalLoader = () => {
      loadCount += 1;
      if (loadCount === 1) return new Promise<{ proposals: Proposal[] }>((resolve) => { resolveInitial = resolve; });
      if (loadCount === 2) return Promise.reject(new Error("Proposal lookup failed."));
      return Promise.resolve({ proposals: [proposal] });
    };
    renderMarketplace({ proposals: [proposal], proposalLoader });

    expect(screen.getByRole("status")).toHaveTextContent("Loading job and proposal details");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    resolveInitial?.({ proposals: [proposal] });
    expect(await screen.findByText("Private proposal content for reload recovery.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Shortlist" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Proposal lookup failed.");
    expect(screen.getByText("Proposal details could not be loaded. They remain hidden until the request succeeds.")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Private proposal content for reload recovery.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry proposals" }));
    expect(await screen.findByText("Private proposal content for reload recovery.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces the empty proposals state", async () => {
    renderMarketplace({ proposals: [] });
    expect(await screen.findByText(/No proposals yet\./)).toHaveAttribute("role", "status");
    expect(screen.getByText(/Applicants' submissions will appear here/)).toBeInTheDocument();
  });
});

describe("freelancer proposal review before submission", () => {
  beforeEach(() => { vi.restoreAllMocks(); installLocalStorage(); mocks.apiRequest.mockReset(); mocks.user = { id: "freelancer-review-account" }; });

  it("previews proposal details and returns to editing without losing entered values", async () => {
    const user = userEvent.setup();
    const coverLetter = "I will deliver a responsive first release and share progress at each review milestone.";
    renderMarketplace({ roles: ["freelancer"], isOwner: false, proposals: [], portfolio: [{ id: portfolioItemId, title: "Scheduling dashboard case study" }] });
    await screen.findByRole("heading", { name: "Send a thoughtful proposal" });

    await user.type(screen.getByRole("textbox", { name: "Cover letter" }), coverLetter);
    await user.type(screen.getByRole("textbox", { name: "Your quote (USD)" }), "125.50");
    const timeline = screen.getByRole("spinbutton", { name: "Expected timeline (days)" });
    await user.clear(timeline);
    await user.type(timeline, "21");
    await user.click(screen.getByRole("checkbox", { name: "Scheduling dashboard case study" }));
    await user.click(screen.getByRole("button", { name: "Review proposal" }));

    const heading = await screen.findByRole("heading", { name: "Review your proposal" });
    expect(heading).toHaveFocus();
    expect(screen.getByText(coverLetter)).toBeInTheDocument();
    expect(screen.getByText("$125.50 (USD)")).toBeInTheDocument();
    expect(screen.getByText("21 days")).toBeInTheDocument();
    expect(screen.getByText("Scheduling dashboard case study")).toBeInTheDocument();
    expect(marketplaceStyles).toContain(".marketplace-proposal-review-details { display:grid; grid-template-columns:repeat(2,minmax(0,1fr));");
    expect(marketplaceStyles).toContain(".marketplace-proposal-review-actions { align-items:stretch; flex-direction:column; }");
    expect(mocks.apiRequest.mock.calls.some(([path, options]) => path === `/api/jobs/${jobId}/proposals` && options?.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Return to editing" }));
    expect(screen.getByRole("textbox", { name: "Cover letter" })).toHaveValue(coverLetter);
    expect(screen.getByRole("textbox", { name: "Cover letter" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Your quote (USD)" })).toHaveValue("125.50");
    expect(screen.getByRole("spinbutton", { name: "Expected timeline (days)" })).toHaveValue(21);
    expect(screen.getByRole("checkbox", { name: "Scheduling dashboard case study" })).toBeChecked();
  });

  it("clearly lists missing or invalid required fields and blocks confirmation", async () => {
    const user = userEvent.setup();
    renderMarketplace({ roles: ["freelancer"], isOwner: false, proposals: [] });
    await screen.findByRole("heading", { name: "Send a thoughtful proposal" });
    await user.type(screen.getByRole("textbox", { name: "Cover letter" }), "Too short");
    await user.type(screen.getByRole("textbox", { name: "Your quote (USD)" }), "0.00");
    const timeline = screen.getByRole("spinbutton", { name: "Expected timeline (days)" });
    await user.clear(timeline);
    await user.type(timeline, "0");
    await user.click(screen.getByRole("button", { name: "Review proposal" }));

    const errors = await screen.findByRole("alert");
    expect(errors).toHaveTextContent("Cover letter must contain 30 to 5,000 characters.");
    expect(errors).toHaveTextContent("Enter a positive exact quote using the job currency.");
    expect(errors).toHaveTextContent("Delivery timeline must be a whole number from 1 to 3,650 days.");
    expect(screen.getByText("Invalid amount: 0.00 USD")).toBeInTheDocument();
    expect(screen.getByText("Invalid timeline: 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm and submit proposal" })).toBeDisabled();
    expect(mocks.apiRequest.mock.calls.some(([path, options]) => path === `/api/jobs/${jobId}/proposals` && options?.method === "POST")).toBe(false);
  });

  it("requires explicit confirmation and ignores duplicate clicks while a request is pending", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((result: { proposalId: string }) => void) | undefined;
    const apiOverride = (path: string, options?: { method?: string }) => {
      if (path === `/api/jobs/${jobId}/proposals` && options?.method === "POST") {
        return new Promise<{ proposalId: string }>((resolve) => { resolveCreate = resolve; });
      }
      return undefined;
    };
    renderMarketplace({ roles: ["freelancer"], isOwner: false, proposals: [], apiOverride });
    await screen.findByRole("heading", { name: "Send a thoughtful proposal" });
    await user.type(screen.getByRole("textbox", { name: "Cover letter" }), "I will deliver the agreed scope with clear milestones and a documented handoff.");
    await user.type(screen.getByRole("textbox", { name: "Your quote (USD)" }), "125.50");
    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(mocks.apiRequest.mock.calls.some(([path, options]) => path === `/api/jobs/${jobId}/proposals` && options?.method === "POST")).toBe(false);

    const confirm = screen.getByRole("button", { name: "Confirm and submit proposal" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(screen.getByRole("status")).toHaveTextContent("Submitting proposal");
    const createCalls = mocks.apiRequest.mock.calls.filter(([path, options]) => path === `/api/jobs/${jobId}/proposals` && options?.method === "POST");
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.[1]?.body).toMatchObject({ coverLetter: "I will deliver the agreed scope with clear milestones and a documented handoff.", quoteMinor: 12550, timelineDays: 14, portfolioItemIds: [] });

    resolveCreate?.({ proposalId: "proposal-created" });
    expect(await screen.findByText("Proposal submitted.")).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith("/api/proposals/proposal-created/transition", { method: "POST", body: { action: "submit" } });
  });

  it("supports keyboard review and confirmation", async () => {
    const user = userEvent.setup();
    renderMarketplace({ roles: ["freelancer"], isOwner: false, proposals: [] });
    await screen.findByRole("heading", { name: "Send a thoughtful proposal" });
    await user.type(screen.getByRole("textbox", { name: "Cover letter" }), "I will deliver the agreed scope with clear milestones and a documented handoff.");
    await user.type(screen.getByRole("textbox", { name: "Your quote (USD)" }), "125.50");
    await user.click(screen.getByRole("button", { name: "Review proposal" }));

    await screen.findByRole("heading", { name: "Review your proposal" });
    await user.tab();
    expect(screen.getByRole("button", { name: "Return to editing" })).toHaveFocus();
    await user.tab();
    const confirm = screen.getByRole("button", { name: "Confirm and submit proposal" });
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Proposal submitted.")).toBeInTheDocument();
    expect(mocks.apiRequest.mock.calls.filter(([path, options]) => path === `/api/jobs/${jobId}/proposals` && options?.method === "POST")).toHaveLength(1);
  });

  it("shows API failures and allows a clear retry", async () => {
    const user = userEvent.setup();
    let createAttempts = 0;
    const apiOverride = (path: string, options?: { method?: string }) => {
      if (path === `/api/jobs/${jobId}/proposals` && options?.method === "POST") {
        createAttempts += 1;
        if (createAttempts === 1) throw new Error("Temporary network failure.");
        return { proposalId: "proposal-retried" };
      }
      return undefined;
    };
    renderMarketplace({ roles: ["freelancer"], isOwner: false, proposals: [], apiOverride });
    await screen.findByRole("heading", { name: "Send a thoughtful proposal" });
    await user.type(screen.getByRole("textbox", { name: "Cover letter" }), "I will deliver the agreed scope with clear milestones and a documented handoff.");
    await user.type(screen.getByRole("textbox", { name: "Your quote (USD)" }), "125.50");
    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    await user.click(screen.getByRole("button", { name: "Confirm and submit proposal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary network failure.");
    expect(screen.getByRole("button", { name: "Confirm and submit proposal" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Confirm and submit proposal" }));
    expect(await screen.findByText("Proposal submitted.")).toBeInTheDocument();
    expect(createAttempts).toBe(2);
    expect(mocks.apiRequest).toHaveBeenCalledWith("/api/proposals/proposal-retried/transition", { method: "POST", body: { action: "submit" } });
  });
});

describe("freelancer saved job-search presets", () => {
  beforeEach(() => { vi.restoreAllMocks(); installLocalStorage(); mocks.apiRequest.mockReset(); mocks.user = { id: "preset-account" }; window.localStorage.clear(); });

  it("applies every saved filter and returns matching favorite jobs in the saved sort order", async () => {
    const user = userEvent.setup();
    const filters = {
      keyword: "React", category: "Development", projectType: "fixed", experience: "intermediate",
      skill: "TypeScript", budgetMin: "500", budgetMax: "900", budgetCurrency: "USD",
      sort: "budget_low", savedOnly: true,
    };
    const makeJob = (id: string, title: string, amount: string, options: { favorite?: boolean; category?: string; projectType?: string } = {}) => ({
      id, title, summary: "React project with TypeScript", description: "A persisted listing for testing marketplace filters.",
      requirements: ["React delivery"], skills: ["React", "TypeScript"], category: options.category ?? "Development",
      experienceLevel: "intermediate", projectType: options.projectType ?? "fixed", fixedBudgetMinor: amount,
      hourlyRateMinMinor: null, hourlyRateMaxMinor: null, currency: "USD", estimatedDays: 20,
      status: "published", isFavorite: options.favorite ?? true, createdAt: "2026-11-01T10:00:00.000Z",
    });
    const jobs = [
      makeJob("expensive", "React Search Expensive", "85000"),
      makeJob("affordable", "React Search Affordable", "65000"),
      makeJob("not-saved", "React Search Not Saved", "70000", { favorite: false }),
      makeJob("wrong-category", "React Search Other Category", "60000", { category: "Design" }),
      makeJob("wrong-type", "React Search Hourly", "60000", { projectType: "hourly" }),
      makeJob("over-budget", "React Search Over Budget", "100000"),
    ];
    window.localStorage.setItem("proofpay:marketplace:job-search-presets:v1:preset-account", JSON.stringify({
      version: 1, presets: [{ id: "preset-1", name: "Saved React jobs", filters }],
    }));
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/profile") return { roles: ["freelancer"], portfolio: [] };
      if (path === "/api/offers") return { offers: [] };
      if (path === "/api/jobs") return { jobs };
      throw new Error("Unexpected API request: " + path);
    });

    const view = render(<MemoryRouter initialEntries={["/app/opportunities"]}>
      <Routes><Route path="/app/opportunities" element={<OpportunitiesPage />} /></Routes>
    </MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Apply saved search Saved React jobs" }));

    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveValue("React");
    expect(screen.getByRole("combobox", { name: "Category filter" })).toHaveValue("Development");
    expect(screen.getByRole("combobox", { name: "Project type filter" })).toHaveValue("fixed");
    expect(screen.getByRole("combobox", { name: "Experience filter" })).toHaveValue("intermediate");
    expect(screen.getByRole("textbox", { name: "Skill filter" })).toHaveValue("TypeScript");
    expect(screen.getByRole("textbox", { name: "Minimum budget" })).toHaveValue("500");
    expect(screen.getByRole("textbox", { name: "Maximum budget" })).toHaveValue("900");
    expect(screen.getByRole("textbox", { name: "Budget currency" })).toHaveValue("USD");
    expect(screen.getByRole("combobox", { name: "Sort jobs" })).toHaveValue("budget_low");
    expect(screen.getByRole("button", { name: "Saved jobs" })).toHaveAttribute("aria-pressed", "true");
    const cards = Array.from(view.container.querySelectorAll(".marketplace-job-card h2")).map((heading) => heading.textContent);
    expect(cards).toEqual(["React Search Affordable", "React Search Expensive"]);

    const activeFilters = screen.getByRole("region", { name: "Active job-search filters" });
    expect(within(activeFilters).getAllByRole("button", { name: "Clear filters" })).toHaveLength(1);
    expect(within(activeFilters).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Keyword: React", "Category: Development", "Project type: Fixed price", "Experience: Intermediate",
      "Skill: TypeScript", "Budget (USD): minimum 500, maximum 900", "Saved jobs only", "Sort: Budget: low to high", "Clear filters",
    ]);

    await user.clear(screen.getByRole("textbox", { name: "Search jobs" }));
    await user.type(screen.getByRole("textbox", { name: "Search jobs" }), "Vue");
    expect(screen.getByRole("button", { name: "Remove keyword filter: Vue" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "No matching jobs" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("region", { name: "Active job-search filters" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Category filter" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Project type filter" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Experience filter" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Skill filter" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Minimum budget" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Maximum budget" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Budget currency" })).toHaveValue("USD");
    expect(screen.getByRole("combobox", { name: "Sort jobs" })).toHaveValue("recent");
    expect(screen.getByRole("button", { name: "Saved jobs" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveFocus();
    expect(view.container.querySelectorAll(".marketplace-job-card")).toHaveLength(jobs.length);

    await user.click(screen.getByRole("button", { name: "Apply saved search Saved React jobs" }));
    expect(screen.getByRole("button", { name: "Remove keyword filter: React" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove category filter: Development" }));
    expect(screen.getByRole("combobox", { name: "Category filter" })).toHaveValue("");
    expect(await screen.findByText("React Search Other Category")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove project type filter: Fixed price" })).toBeInTheDocument();
  });

  it("does not expose saved-search controls to an authenticated client", async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === "/api/profile") return { roles: ["client"], portfolio: [] };
      if (path === "/api/offers") return { offers: [] };
      if (path === "/api/jobs") return { jobs: [] };
      throw new Error("Unexpected API request: " + path);
    });
    render(<MemoryRouter initialEntries={["/app/opportunities"]}>
      <Routes><Route path="/app/opportunities" element={<OpportunitiesPage />} /></Routes>
    </MemoryRouter>);

    expect(await screen.findByText(/no marketplace jobs yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Saved job searches" })).not.toBeInTheDocument();
  });
});
