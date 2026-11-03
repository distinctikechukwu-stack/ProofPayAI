import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { JobSearchFilters } from "./SavedJobSearchPresets";

export type ActiveJobFilterId = "keyword" | "category" | "projectType" | "experience" | "skill" | "budget" | "savedOnly" | "sort";
type ActiveJobFilterValues = Partial<Record<keyof JobSearchFilters, unknown>>;
export type ActiveJobFilterChip = { id: ActiveJobFilterId; label: string; accessibleLabel: string };

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

function displayValue(value: unknown): string {
  if (typeof value !== "string") return "Unsupported value";
  return value.trim() || "blank";
}

function isSupportedCurrency(currency: unknown): currency is string {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) || currency === "ZZZ") return false;
  try {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] }).supportedValuesOf?.("currency");
    if (supported) return supported.includes(currency);
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().currency === currency;
  } catch { return false; }
}

function displayBudgetBound(value: unknown): string | null {
  if (!hasValue(value)) return null;
  if (typeof value !== "string") return "invalid amount";
  return value.trim() || "blank amount";
}

export function buildActiveJobFilterChips(filters: ActiveJobFilterValues): ActiveJobFilterChip[] {
  const chips: ActiveJobFilterChip[] = [];
  const textFilter = (id: "keyword" | "category" | "skill", title: string, value: unknown) => {
    if (!hasValue(value)) return;
    const visible = displayValue(value);
    chips.push({ id, label: `${title}: ${visible}`, accessibleLabel: `Remove ${title.toLocaleLowerCase()} filter${visible === "Unsupported value" ? " (unsupported value)" : `: ${visible}`}` });
  };

  textFilter("keyword", "Keyword", filters.keyword);
  textFilter("category", "Category", filters.category);

  if (hasValue(filters.projectType)) {
    const label = filters.projectType === "fixed" ? "Fixed price" : filters.projectType === "hourly" ? "Hourly" : "Unsupported value";
    chips.push({ id: "projectType", label: `Project type: ${label}`, accessibleLabel: `Remove project type filter${label === "Unsupported value" ? " (unsupported value)" : `: ${label}`}` });
  }
  if (hasValue(filters.experience)) {
    const labels: Record<string, string> = { entry: "Entry level", intermediate: "Intermediate", expert: "Expert" };
    const label = typeof filters.experience === "string" ? labels[filters.experience] ?? "Unsupported value" : "Unsupported value";
    chips.push({ id: "experience", label: `Experience: ${label}`, accessibleLabel: `Remove experience filter${label === "Unsupported value" ? " (unsupported value)" : `: ${label}`}` });
  }
  textFilter("skill", "Skill", filters.skill);

  const minimum = displayBudgetBound(filters.budgetMin);
  const maximum = displayBudgetBound(filters.budgetMax);
  if (minimum !== null || maximum !== null) {
    const currency = isSupportedCurrency(filters.budgetCurrency) ? filters.budgetCurrency : "unsupported currency";
    const range = [minimum !== null ? `minimum ${minimum}` : "", maximum !== null ? `maximum ${maximum}` : ""].filter(Boolean).join(", ");
    chips.push({ id: "budget", label: `Budget (${currency}): ${range}`, accessibleLabel: "Remove budget filter" });
  }

  if (filters.savedOnly === true) chips.push({ id: "savedOnly", label: "Saved jobs only", accessibleLabel: "Remove saved jobs only filter" });
  else if (hasValue(filters.savedOnly)) chips.push({ id: "savedOnly", label: "Saved jobs filter: Unsupported value", accessibleLabel: "Remove saved jobs filter (unsupported value)" });

  if (hasValue(filters.sort) && filters.sort !== "recent") {
    const label = filters.sort === "budget_low" ? "Budget: low to high" : filters.sort === "budget_high" ? "Budget: high to low" : "Unsupported value";
    chips.push({ id: "sort", label: `Sort: ${label}`, accessibleLabel: `Remove sort filter${label === "Unsupported value" ? " (unsupported value)" : `: ${label}`}` });
  }
  return chips;
}

export function ActiveJobFilterChips({ filters, onRemove, onClearFilters }: {
  filters: ActiveJobFilterValues;
  onRemove: (filter: ActiveJobFilterId) => void;
  onClearFilters: () => void;
}) {
  const chips = buildActiveJobFilterChips(filters);
  const buttonRefs = useRef(new Map<ActiveJobFilterId, HTMLButtonElement>());
  const pendingFocusIndex = useRef<number | null>(null);

  useEffect(() => {
    const index = pendingFocusIndex.current;
    if (index === null) return;
    pendingFocusIndex.current = null;
    const nextChip = chips[Math.min(index, chips.length - 1)];
    if (nextChip) buttonRefs.current.get(nextChip.id)?.focus();
    else document.getElementById("marketplace-job-search")?.focus();
  }, [chips]);

  if (chips.length === 0) return null;
  return <section className="marketplace-active-filters" aria-label="Active job-search filters">
    <ul className="marketplace-active-filter-list" aria-label="Active filters">
      {chips.map((chip) => <li key={chip.id}>
        <button type="button" className="marketplace-active-filter-chip" aria-label={chip.accessibleLabel} title={chip.label}
          ref={(node) => { if (node) buttonRefs.current.set(chip.id, node); else buttonRefs.current.delete(chip.id); }}
          onClick={() => { pendingFocusIndex.current = chips.findIndex((item) => item.id === chip.id); onRemove(chip.id); }}>
          <span>{chip.label}</span><X size={14} aria-hidden="true" />
        </button>
      </li>)}
    </ul>
    <button type="button" className="marketplace-clear-filters" onClick={() => { onClearFilters(); document.getElementById("marketplace-job-search")?.focus(); }}>Clear filters</button>
  </section>;
}
