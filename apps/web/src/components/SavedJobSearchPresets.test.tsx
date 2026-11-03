import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedJobSearchPresets, jobSearchPresetsStorageKey, type JobSearchFilters } from "./SavedJobSearchPresets";

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

const filters: JobSearchFilters = {
  keyword: "React",
  category: "Development",
  projectType: "fixed",
  experience: "intermediate",
  skill: "TypeScript",
  budgetMin: "500",
  budgetMax: "900",
  budgetCurrency: "USD",
  sort: "budget_low",
  savedOnly: true,
};
const marketplaceStyles = readFileSync("src/styles/marketplace.css", "utf8");

function renderPresets({ userId = "account-a", currentFilters = filters, onApply = vi.fn() }: {
  userId?: string;
  currentFilters?: JobSearchFilters;
  onApply?: (value: JobSearchFilters) => void;
} = {}) {
  return render(<SavedJobSearchPresets userId={userId} filters={currentFilters} onApply={onApply} />);
}

describe("saved job-search presets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorage();
    window.localStorage.clear();
  });

  it("creates a user-scoped preset with all supported filters and reapplies it in one action", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderPresets({ onApply });

    const presetName = screen.getByLabelText("Name this search");
    await user.type(presetName, "  React roles  ");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("React roles")).toBeInTheDocument();

    const key = jobSearchPresetsStorageKey("account-a");
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "null");
    expect(saved).toEqual({ version: 1, presets: [{ id: expect.any(String), name: "React roles", filters }] });
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(key)).not.toMatch(/password|token|credential|email|profile/i);

    await user.click(screen.getByRole("button", { name: "Apply saved search React roles" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(filters);
    expect(screen.getByRole("status")).toHaveTextContent("Applied “React roles”.");
    expect(screen.getByText(/do not sync across devices/i)).toBeInTheDocument();
  });

  it("renames and deletes a saved preset accessibly", async () => {
    const user = userEvent.setup();
    renderPresets();
    await user.type(screen.getByLabelText("Name this search"), "React roles");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));

    await user.click(screen.getByRole("button", { name: "Rename saved search React roles" }));
    const rename = screen.getByRole("textbox", { name: "New name for React roles" });
    await user.clear(rename);
    await user.type(rename, "Frontend work");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("button", { name: "Apply saved search Frontend work" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete saved search Frontend work" }));
    expect(screen.queryByRole("button", { name: "Apply saved search Frontend work" })).not.toBeInTheDocument();
    expect(screen.getByText(/no saved searches yet/i)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(jobSearchPresetsStorageKey("account-a")) ?? "null").presets).toEqual([]);
  });

  it("isolates account storage through logout and account changes in the same browser", async () => {
    const user = userEvent.setup();
    const accountBKey = jobSearchPresetsStorageKey("account-b");
    window.localStorage.setItem(accountBKey, JSON.stringify({ version: 1, presets: [{ id: "b-1", name: "Account B private search", filters }] }));
    const view = render(<SavedJobSearchPresets key="account-a" userId="account-a" filters={filters} onApply={vi.fn()} />);
    await user.type(screen.getByLabelText("Name this search"), "Account A private search");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));
    expect(await screen.findByText("Account A private search")).toBeInTheDocument();

    view.rerender(<div aria-label="Signed out" />);
    view.rerender(<SavedJobSearchPresets key="account-b" userId="account-b" filters={filters} onApply={vi.fn()} />);
    expect(await screen.findByText("Account B private search")).toBeInTheDocument();
    expect(screen.queryByText("Account A private search")).not.toBeInTheDocument();

    view.rerender(<div aria-label="Signed out" />);
    view.rerender(<SavedJobSearchPresets key="account-a" userId="account-a" filters={filters} onApply={vi.fn()} />);
    expect(await screen.findByText("Account A private search")).toBeInTheDocument();
    expect(screen.queryByText("Account B private search")).not.toBeInTheDocument();
  });

  it("recovers from malformed JSON and replaces it only after the user saves a valid preset", async () => {
    const user = userEvent.setup();
    const key = jobSearchPresetsStorageKey("account-a");
    window.localStorage.setItem(key, "{bad json");
    renderPresets();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be read/i);
    await user.type(screen.getByLabelText("Name this search"), "Fresh search");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));
    expect(await screen.findByText("Fresh search")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(key) ?? "null").presets).toHaveLength(1);
  });

  it("skips corrupted presets with unsupported values and duplicate names", async () => {
    const key = jobSearchPresetsStorageKey("account-a");
    window.localStorage.setItem(key, JSON.stringify({ version: 1, presets: [
      { id: "valid-1", name: "Good search", filters },
      { id: "invalid-enum", name: "Bad experience", filters: { ...filters, experience: "principal" } },
      { id: "invalid-currency", name: "Bad currency", filters: { ...filters, budgetCurrency: "XYZ123" } },
      { id: "duplicate-name", name: "good SEARCH", filters },
    ] }));
    renderPresets();

    expect(await screen.findByText("Good search")).toBeInTheDocument();
    expect(screen.queryByText("Bad experience")).not.toBeInTheDocument();
    expect(screen.queryByText("Bad currency")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/some saved searches were skipped/i);
  });

  it("rejects duplicate names, unsupported current filters, and more than ten presets", async () => {
    const user = userEvent.setup();
    const unsupported = { ...filters, sort: "popular" } as unknown as JobSearchFilters;
    const { rerender } = renderPresets({ currentFilters: unsupported });
    await user.type(screen.getByLabelText("Name this search"), "React roles");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/unsupported/i);
    expect(window.localStorage.length).toBe(0);

    rerender(<SavedJobSearchPresets userId="account-a" filters={filters} onApply={vi.fn()} />);
    await user.clear(screen.getByLabelText("Name this search"));
    await user.type(screen.getByLabelText("Name this search"), "React roles");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));
    await user.clear(screen.getByLabelText("Name this search"));
    await user.type(screen.getByLabelText("Name this search"), " react roles ");
    await user.click(screen.getByRole("button", { name: "Save current filters" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/already uses that name/i);
    expect(JSON.parse(window.localStorage.getItem(jobSearchPresetsStorageKey("account-a")) ?? "null").presets).toHaveLength(1);

    const tenPresets = Array.from({ length: 10 }, (_, index) => ({ id: `id-${index}`, name: `Search ${index}`, filters }));
    window.localStorage.setItem(jobSearchPresetsStorageKey("account-full"), JSON.stringify({ version: 1, presets: tenPresets }));
    rerender(<SavedJobSearchPresets userId="account-full" filters={filters} onApply={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Save current filters" })).toBeDisabled();
    expect(screen.getByText("10/10")).toBeInTheDocument();
  });

  it("reports browser storage failures without throwing", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    renderPresets();
    expect(await screen.findByRole("alert")).toHaveTextContent(/blocked local storage/i);
  });

  it("keeps the entered name when saving is blocked and provides stacked mobile controls", async () => {
    const user = userEvent.setup();
    renderPresets();
    const nameInput = screen.getByLabelText("Name this search");
    await user.type(nameInput, "Keep my draft");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await user.click(screen.getByRole("button", { name: "Save current filters" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not save the change/i);
    expect(nameInput).toHaveValue("Keep my draft");
    expect(marketplaceStyles).toMatch(/@media\s*\(max-width:\s*560px\)[\s\S]*?\.marketplace-presets-list>li\s*\{\s*align-items:stretch; flex-direction:column;/);
    expect(marketplaceStyles).toMatch(/\.marketplace-preset-save>div>button\s*\{\s*width:100%;/);
    expect(marketplaceStyles).toMatch(/\.marketplace-presets button:focus-visible[\s\S]*outline:3px solid/);
  });
});
