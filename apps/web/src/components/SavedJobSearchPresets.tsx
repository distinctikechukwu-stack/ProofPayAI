import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

export const MAX_SAVED_SEARCHES = 10;
export const MAX_PRESET_NAME_LENGTH = 40;

export type JobSearchFilters = {
  keyword: string;
  category: string;
  projectType: "" | "fixed" | "hourly";
  experience: "" | "entry" | "intermediate" | "expert";
  skill: string;
  budgetMin: string;
  budgetMax: string;
  budgetCurrency: string;
  sort: "recent" | "budget_low" | "budget_high";
  savedOnly: boolean;
};

type SavedPreset = { id: string; name: string; filters: JobSearchFilters };
const projectTypeSchema = z.enum(["", "fixed", "hourly"]);
const experienceSchema = z.enum(["", "entry", "intermediate", "expert"]);
const sortSchema = z.enum(["recent", "budget_low", "budget_high"]);
const currencySchema = z.string().regex(/^[A-Z]{3}$/).refine(isSupportedCurrency);
const filterSchema = z.object({
  keyword: z.string().max(200),
  category: z.string().max(80),
  projectType: projectTypeSchema,
  experience: experienceSchema,
  skill: z.string().max(80),
  budgetMin: z.string().max(24),
  budgetMax: z.string().max(24),
  budgetCurrency: currencySchema,
  sort: sortSchema,
  savedOnly: z.boolean(),
}).strict().superRefine((filters, context) => {
  const min = parseAmountMinor(filters.budgetMin, filters.budgetCurrency);
  const max = parseAmountMinor(filters.budgetMax, filters.budgetCurrency);
  if (filters.budgetMin && min === null) context.addIssue({ code: "custom", path: ["budgetMin"], message: "Enter a valid minimum budget." });
  if (filters.budgetMax && max === null) context.addIssue({ code: "custom", path: ["budgetMax"], message: "Enter a valid maximum budget." });
  if (min !== null && max !== null && min > max) context.addIssue({ code: "custom", path: ["budgetMax"], message: "Maximum budget must be at least the minimum." });
});
const presetSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(MAX_PRESET_NAME_LENGTH),
  filters: filterSchema,
}).strict();
const storageRootSchema = z.object({ version: z.literal(1), presets: z.array(z.unknown()).max(1000) }).strict();

export function jobSearchPresetsStorageKey(userId: string): string {
  return `proofpay:marketplace:job-search-presets:v1:${userId}`;
}

function isSupportedCurrency(value: string): boolean {
  try {
    if (value !== value.toUpperCase() || value === "ZZZ") return false;
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] }).supportedValuesOf?.("currency");
    if (supported) return supported.includes(value);
    return new Intl.NumberFormat("en-US", { style: "currency", currency: value }).resolvedOptions().currency === value;
  } catch { return false; }
}

function parseAmountMinor(value: string, currency: string): bigint | null {
  if (!value.trim()) return null;
  let digits: number;
  try { digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return null; }
  const match = digits === 0
    ? /^(\d+)$/.exec(value.trim())
    : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(value.trim());
  if (!match?.[1]) return null;
  try {
    const minor = BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
    return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? minor : null;
  } catch { return null; }
}

function parseStoredPresets(raw: string): { presets: SavedPreset[]; issue: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { presets: [], issue: "Saved searches could not be read from this browser. Saving a new preset will replace the invalid entry." }; }
  const root = storageRootSchema.safeParse(parsed);
  if (!root.success) return { presets: [], issue: "Saved searches have an unsupported or damaged format. Saving a new preset will replace the invalid entry." };

  const valid: SavedPreset[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  let skipped = false;
  for (const candidate of root.data.presets) {
    const result = presetSchema.safeParse(candidate);
    if (!result.success || names.has(result.data.name.toLocaleLowerCase()) || ids.has(result.data.id)) { skipped = true; continue; }
    if (valid.length >= MAX_SAVED_SEARCHES) { skipped = true; continue; }
    names.add(result.data.name.toLocaleLowerCase());
    ids.add(result.data.id);
    valid.push(result.data);
  }
  return { presets: valid, issue: skipped ? "Some saved searches were skipped because they were duplicated, unsupported, or over the limit." : "" };
}

export function SavedJobSearchPresets({ userId, filters, onApply }: {
  userId: string;
  filters: JobSearchFilters;
  onApply: (filters: JobSearchFilters) => void;
}) {
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [issue, setIssue] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const storageKey = jobSearchPresetsStorageKey(userId);

  useEffect(() => {
    setPresets([]);
    setName("");
    setEditing(null);
    setIssue("");
    setMessage("");
    setLoaded(false);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) {
        const result = parseStoredPresets(raw);
        setPresets(result.presets);
        setIssue(result.issue);
      }
    } catch {
      setIssue("Saved searches are unavailable because this browser blocked local storage.");
    }
    setLoaded(true);
  }, [storageKey]);

  const write = (next: SavedPreset[], successMessage: string): boolean => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, presets: next }));
      setPresets(next);
      setIssue("");
      setMessage(successMessage);
      return true;
    } catch {
      setIssue("This browser could not save the change. Check local storage availability and try again.");
      setMessage("");
      return false;
    }
  };

  const saveCurrent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > MAX_PRESET_NAME_LENGTH) {
      setIssue(`Enter a preset name between 1 and ${MAX_PRESET_NAME_LENGTH} characters.`);
      return;
    }
    if (presets.length >= MAX_SAVED_SEARCHES) {
      setIssue(`You can save up to ${MAX_SAVED_SEARCHES} searches. Delete one before saving another.`);
      return;
    }
    if (presets.some((preset) => preset.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      setIssue("A saved search already uses that name. Choose a different name.");
      return;
    }
    const validated = filterSchema.safeParse(filters);
    if (!validated.success) {
      setIssue("Some filters are unsupported or invalid and could not be saved.");
      return;
    }
    const next = [...presets, { id: crypto.randomUUID(), name: cleanName, filters: validated.data }];
    if (write(next, `Saved “${cleanName}”.`)) setName("");
  };

  const renamePreset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const cleanName = editing.name.trim();
    if (!cleanName || cleanName.length > MAX_PRESET_NAME_LENGTH) {
      setIssue(`Enter a preset name between 1 and ${MAX_PRESET_NAME_LENGTH} characters.`);
      return;
    }
    if (presets.some((preset) => preset.id !== editing.id && preset.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      setIssue("A saved search already uses that name. Choose a different name.");
      return;
    }
    if (write(presets.map((preset) => preset.id === editing.id ? { ...preset, name: cleanName } : preset), `Renamed search to “${cleanName}”.`)) setEditing(null);
  };

  const deletePreset = (preset: SavedPreset) => {
    write(presets.filter((item) => item.id !== preset.id), `Deleted “${preset.name}”.`);
    if (editing?.id === preset.id) setEditing(null);
  };

  return <section className="marketplace-presets" aria-labelledby="saved-searches-heading">
    <div className="marketplace-presets-heading"><div><h2 id="saved-searches-heading">Saved job searches</h2><p>Saved on this browser only. Presets do not sync across devices.</p></div><span>{presets.length}/{MAX_SAVED_SEARCHES}</span></div>
    {issue && <p className="marketplace-presets-message error" role="alert">{issue}</p>}
    {message && <p className="marketplace-presets-message" role="status" aria-live="polite">{message}</p>}
    {loaded && presets.length === 0 && <p className="marketplace-presets-empty">No saved searches yet. Save the filters below to reuse them.</p>}
    {presets.length > 0 && <ul className="marketplace-presets-list">{presets.map((preset) => <li key={preset.id}>
      {editing?.id === preset.id ? <form className="marketplace-preset-rename" onSubmit={renamePreset}>
        <label>New name for {preset.name}<input autoFocus maxLength={MAX_PRESET_NAME_LENGTH} required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        <button className="button-secondary" type="submit">Save name</button>
        <button className="marketplace-preset-action" type="button" onClick={() => setEditing(null)}>Cancel rename</button>
      </form> : <>
        <strong>{preset.name}</strong>
        <div className="marketplace-preset-actions">
          <button className="button-secondary" type="button" aria-label={`Apply saved search ${preset.name}`} onClick={() => { onApply(preset.filters); setMessage(`Applied “${preset.name}”.`); setIssue(""); }}>Apply</button>
          <button className="marketplace-preset-action" type="button" aria-label={`Rename saved search ${preset.name}`} onClick={() => { setIssue(""); setMessage(""); setEditing({ id: preset.id, name: preset.name }); }}>Rename</button>
          <button className="marketplace-preset-action danger" type="button" aria-label={`Delete saved search ${preset.name}`} onClick={() => deletePreset(preset)}>Delete</button>
        </div>
      </>}
    </li>)}</ul>}
    <form className="marketplace-preset-save" onSubmit={saveCurrent}>
      <label htmlFor="saved-search-name">Name this search</label>
      <div><input id="saved-search-name" maxLength={MAX_PRESET_NAME_LENGTH} required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Senior React roles" /><button className="button-primary" type="submit" disabled={!loaded || presets.length >= MAX_SAVED_SEARCHES}>Save current filters</button></div>
    </form>
  </section>;
}
