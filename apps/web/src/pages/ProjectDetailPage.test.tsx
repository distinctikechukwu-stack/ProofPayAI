import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectDetailPage } from "./ProjectDetailPage";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  userId: "client-user",
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: mocks.userId } }),
}));

vi.mock("../lib/api", () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error {},
}));

const projectId = "117a3dce-1981-4e85-ad72-34b236ff49ba";
const milestoneId = "1d8f102d-0716-42d2-8c8c-82d1838f8314";
const privatePath = `${projectId}/${milestoneId}/not-for-browser.pdf`;

function projectResponse(evidenceUrl: string | null = "https://evidence.example.test/work") {
  return {
    project: {
      id: projectId, created_by: "freelancer-user", title: "Fictional project", description: "A private project",
      client_name: "Fictional client", budget_minor: "60000", currency: "USD", contract_type: "fixed",
      deadline: null, status: "in_progress", current_agreement_version_id: "agreement-version",
    },
    milestones: [{
      id: milestoneId, sequence: 1, title: "Milestone 1", description: "Complete the first stage", deliverables: ["Responsive page"],
      acceptance_criteria: ["Reviewable on mobile"], completion_conditions: ["Client review"], amount_minor: "60000",
      currency: "USD", due_date: null, dependency_sequences: [], workflow_status: "revision_requested",
    }],
    agreements: [{
      id: "agreement-version", version_number: 1, state: "accepted", title: "Agreement", scope_text: "Build a page.",
      terms: {}, total_minor: "60000", currency: "USD", created_at: "2026-11-01T10:00:00Z",
    }],
    scopeRequests: [], aiAnalyses: [], changeOrders: [],
    deliverables: [
      { id: "submission-1", milestone_id: milestoneId, description: "Finished the first page and checked its layout.", evidence_url: evidenceUrl, has_private_file: false, created_at: "2026-11-04T10:00:00Z" },
      { id: "submission-2", milestone_id: milestoneId, description: "Attached the requested private design file.", evidence_url: null, has_private_file: true, created_at: "2026-11-04T11:00:00Z" },
    ],
    milestoneReviews: [{
      id: "review-1", milestone_id: milestoneId, deliverable_id: "submission-1", decision: "request_revision",
      note: "Please include the agreed mobile layout. <img src=x onerror=alert(1)>", created_at: "2026-11-04T10:30:00Z",
    }],
  };
}

function renderProject() {
  return render(<MemoryRouter initialEntries={[`/app/projects/${projectId}`]}>
    <Routes><Route path="/app/projects/:projectId" element={<ProjectDetailPage />} /></Routes>
  </MemoryRouter>);
}

describe("persisted milestone evidence and review history", () => {
  beforeEach(() => {
    mocks.userId = "client-user";
    mocks.apiRequest.mockReset().mockResolvedValue(projectResponse());
  });
  afterEach(() => cleanup());

  it("shows evidence, summaries, and client revision feedback after loading for both project participants", async () => {
    for (const userId of ["client-user", "freelancer-user"]) {
      mocks.userId = userId;
      const view = renderProject();

      expect(await screen.findByRole("heading", { name: "Milestone 1" })).toBeInTheDocument();
      expect(screen.getByText("Finished the first page and checked its layout.")).toBeInTheDocument();
      const evidenceLink = screen.getByRole("link", { name: "https://evidence.example.test/work" });
      expect(evidenceLink).toHaveAttribute("href", "https://evidence.example.test/work");
      expect(evidenceLink).toHaveAttribute("target", "_blank");
      expect(evidenceLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(screen.getByText("Please include the agreed mobile layout. <img src=x onerror=alert(1)>")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText(/a private file is attached/i)).toBeInTheDocument();
      expect(screen.queryByText(privatePath)).not.toBeInTheDocument();
      expect(mocks.apiRequest).toHaveBeenCalledWith(`/api/projects/${projectId}`);

      view.unmount();
    }
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("does not turn an untrusted non-HTTPS evidence value into a clickable link", async () => {
    mocks.apiRequest.mockResolvedValue(projectResponse("javascript:alert(1)"));
    renderProject();

    expect(await screen.findByText(/saved evidence link is invalid or unsupported/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).not.toBeInTheDocument();
  });
});
