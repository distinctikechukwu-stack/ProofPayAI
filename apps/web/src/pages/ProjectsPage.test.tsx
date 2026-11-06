import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { ProjectsPage } from "./ProjectsPage";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "participant-1" } }),
}));

vi.mock("../lib/api", () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error {},
}));

function WorkspaceOutlet() {
  return <Outlet context={{ role: "client", openNewProject: vi.fn() }} />;
}

function renderProjects() {
  return render(<MemoryRouter initialEntries={["/app/projects"]}>
    <Routes>
      <Route path="/app" element={<WorkspaceOutlet />}>
        <Route path="projects" element={<ProjectsPage />} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

describe("persisted project status labels", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset().mockResolvedValue({ projects: [{
      id: "project-1", created_by: "freelancer-1", title: "Completed project", client_name: "Fictional Client",
      budget_minor: "10000", currency: "USD", contract_type: "fixed", deadline: null, status: "completed",
    }] });
  });
  afterEach(() => cleanup());

  it("labels the persisted completed project as Completed, not Approved", async () => {
    renderProjects();

    expect(await screen.findByText("Completed project")).toBeInTheDocument();
    expect(screen.getByText("Completed", { selector: ".status-pill" })).toBeInTheDocument();
    expect(screen.queryByText("Approved", { selector: ".status-pill" })).not.toBeInTheDocument();
  });
});
