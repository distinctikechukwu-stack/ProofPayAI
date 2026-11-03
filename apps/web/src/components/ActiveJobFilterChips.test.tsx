import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ActiveJobFilterChips, buildActiveJobFilterChips } from "./ActiveJobFilterChips";
import type { JobSearchFilters } from "./SavedJobSearchPresets";

const marketplaceStyles = readFileSync("src/styles/marketplace.css", "utf8");

describe("active job-search filter chips", () => {
  it("summarizes every supported active filter with an accessible removal label", () => {
    const chips = buildActiveJobFilterChips({
      keyword: "React", category: "Development", projectType: "fixed", experience: "intermediate",
      skill: "TypeScript", budgetMin: "500", budgetMax: "900", budgetCurrency: "USD",
      sort: "budget_low", savedOnly: true,
    });

    expect(chips.map(({ label }) => label)).toEqual([
      "Keyword: React", "Category: Development", "Project type: Fixed price", "Experience: Intermediate",
      "Skill: TypeScript", "Budget (USD): minimum 500, maximum 900", "Saved jobs only", "Sort: Budget: low to high",
    ]);
    expect(chips[0].accessibleLabel).toBe("Remove keyword filter: React");
    expect(chips[5].accessibleLabel).toBe("Remove budget filter");
  });

  it("shows no chips when filter values are missing or at their defaults", () => {
    expect(buildActiveJobFilterChips({})).toEqual([]);
    expect(buildActiveJobFilterChips({
      keyword: "", category: "", projectType: "", experience: "", skill: "",
      budgetMin: "", budgetMax: "", budgetCurrency: "USD", sort: "recent", savedOnly: false,
    })).toEqual([]);
  });

  it("labels unsupported and malformed values safely so they can still be removed", () => {
    const chips = buildActiveJobFilterChips({
      keyword: { private: true }, projectType: "contract", experience: "senior", skill: "   ",
      budgetMin: 500, budgetMax: "900", budgetCurrency: "ZZZ", savedOnly: "yes", sort: "random",
    });

    expect(chips.map(({ label }) => label)).toEqual([
      "Keyword: Unsupported value", "Project type: Unsupported value", "Experience: Unsupported value",
      "Skill: blank", "Budget (unsupported currency): minimum invalid amount, maximum 900",
      "Saved jobs filter: Unsupported value", "Sort: Unsupported value",
    ]);
    expect(() => buildActiveJobFilterChips({ budgetMin: "  ", budgetCurrency: "not-a-currency" })).not.toThrow();
  });

  it("supports keyboard removal and returns focus to a useful control", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [filters, setFilters] = useState<Partial<JobSearchFilters>>({ keyword: "React", category: "Development" });
      return <>
        <input id="marketplace-job-search" aria-label="Search jobs" value={filters.keyword ?? ""} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} />
        <ActiveJobFilterChips
          filters={filters}
          onRemove={(id) => setFilters((current) => {
            if (id === "keyword") return { ...current, keyword: "" };
            if (id === "category") return { ...current, category: "" };
            return current;
          })}
          onClearFilters={() => setFilters({})}
        />
      </>;
    }

    render(<Harness />);
    const category = screen.getByRole("button", { name: "Remove category filter: Development" });
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveFocus();
    await user.tab();
    const keyword = screen.getByRole("button", { name: "Remove keyword filter: React" });
    expect(keyword).toHaveFocus();
    await user.keyboard(" ");

    expect(screen.queryByRole("button", { name: "Remove keyword filter: React" })).not.toBeInTheDocument();
    expect(category).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("region", { name: "Active job-search filters" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search jobs" })).toHaveFocus();
  });

  it("uses mobile wrapping, visible keyboard focus, and a single clear-all action", () => {
    expect(marketplaceStyles).toMatch(/\.marketplace-active-filter-chip:focus-visible,\.marketplace-clear-filters:focus-visible\s*\{\s*outline:3px solid/);
    expect(marketplaceStyles).toMatch(/\.marketplace-active-filter-chip\s*\{[^}]*min-height:40px;/);
    expect(marketplaceStyles).toMatch(/@media\s*\(max-width:\s*560px\)\s*\{[^}]*\.marketplace-active-filters\s*\{\s*align-items:stretch; flex-direction:column;/);
    expect(marketplaceStyles).toMatch(/\.marketplace-clear-filters\s*\{[^}]*min-height:40px;/);
  });
});
