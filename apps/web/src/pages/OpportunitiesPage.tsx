import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, BriefcaseBusiness, Check, CircleAlert, Flag, Plus, Printer, Search, Send, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ActiveJobFilterChips, type ActiveJobFilterId } from "../components/ActiveJobFilterChips";
import { FreelancerProposalReview } from "../components/FreelancerProposalReview";
import { ProposalComparisonPrintDocument, type PrintableProposalSummary } from "../components/ProposalComparisonPrintDocument";
import { PageHeading, StatusPill } from "../components/WorkspacePrimitives";
import { SavedJobSearchPresets, type JobSearchFilters } from "../components/SavedJobSearchPresets";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest } from "../lib/api";
import { marketplaceJobInputSchema } from "@proofpay/shared";

type Job = {
  id: string; isOwner?: boolean; title: string; summary: string; description: string; requirements: string[]; skills: string[];
  category: string; experienceLevel: "entry" | "intermediate" | "expert"; projectType: "fixed" | "hourly";
  fixedBudgetMinor: string | null; hourlyRateMinMinor: string | null; hourlyRateMaxMinor: string | null; currency: string;
  estimatedDays: number | null; status: "draft" | "published" | "closed" | "archived"; isFavorite?: boolean; createdAt: string;
};
export type Proposal = {
  id: string; jobId: string; isMine: boolean; coverLetter: string; quoteMinor: string; currency: string;
  timelineDays: number; portfolioItemIds: string[]; status: string; createdAt: string;
};
type Offer = {
  id: string; proposalId: string; jobId: string; isRecipient: boolean; terms: string;
  amountMinor: string; currency: string; timelineDays: number; status: string; projectId: string | null;
  createdAt: string; respondedAt: string | null;
};
type PortfolioRef = { id: string; title: string };
type JobDraft = {
  title: string; summary: string; description: string; requirements: string; skills: string; category: string;
  experienceLevel: Job["experienceLevel"]; projectType: Job["projectType"]; fixedBudget: string;
  hourlyMin: string; hourlyMax: string; currency: string; estimatedDays: string;
};

class PublishOutcomeUnclearError extends Error {}

const emptyJobDraft = (): JobDraft => ({
  title: "", summary: "", description: "", requirements: "", skills: "", category: "",
  experienceLevel: "intermediate", projectType: "fixed", fixedBudget: "", hourlyMin: "", hourlyMax: "",
  currency: "USD", estimatedDays: "",
});
const splitLines = (value: string) => value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
const currencyDigits = (currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
};
function validateJobDraft(draft: JobDraft, idempotencyKey: string, id: string | null) {
  const fixed = draft.projectType === "fixed" ? amountMinor(draft.fixedBudget, draft.currency) : null;
  const hourlyMin = draft.projectType === "hourly" ? amountMinor(draft.hourlyMin, draft.currency) : null;
  const hourlyMax = draft.projectType === "hourly" ? amountMinor(draft.hourlyMax, draft.currency) : null;
  const parsed = marketplaceJobInputSchema.safeParse({
    id, idempotencyKey, title: draft.title, summary: draft.summary, description: draft.description,
    requirements: splitLines(draft.requirements), skills: splitLines(draft.skills), category: draft.category,
    experienceLevel: draft.experienceLevel, projectType: draft.projectType, fixedBudgetMinor: fixed,
    hourlyRateMinMinor: hourlyMin, hourlyRateMaxMinor: hourlyMax, currency: draft.currency,
    estimatedDays: draft.estimatedDays.trim() ? Number(draft.estimatedDays) : null,
  });
  if (parsed.success) return { payload: parsed.data, issues: [] as string[] };
  const labels: Record<string, string> = {
    id: "Listing", idempotencyKey: "Submission", title: "Job title", summary: "Short summary", description: "Description",
    requirements: "Requirements", skills: "Skills", category: "Category", experienceLevel: "Experience level",
    projectType: "Project type", fixedBudgetMinor: "Fixed budget", hourlyRateMinMinor: "Minimum hourly rate",
    hourlyRateMaxMinor: "Maximum hourly rate", currency: "Currency", estimatedDays: "Estimated duration",
  };
  const issues = [...new Set(parsed.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    return `${labels[key] ?? (draft.projectType === "fixed" ? "Fixed budget" : "Hourly rates")}: ${issue.message}`;
  }))];
  return { payload: null, issues };
}
function amountMinor(value: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const match = digits === 0 ? /^(\d+)$/.exec(value.trim()) : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(value.trim());
  if (!match?.[1]) return null;
  try {
    const amount = BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
    return amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
  } catch { return null; }
}
function displayMinor(value: string | null, currency: string): string {
  if (!value || !/^\d+$/.test(value)) return "Budget not specified";
  const digits = currencyDigits(currency);
  const minor = BigInt(value);
  const divisor = 10n ** BigInt(digits);
  const whole = minor / divisor;
  const fraction = digits ? `.${(minor % divisor).toString().padStart(digits, "0")}` : "";
  try { return `${new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(whole)}${fraction}`; }
  catch { return `${currency} ${whole}${fraction}`; }
}
function jobBudget(job: Job) {
  return job.projectType === "fixed"
    ? `${displayMinor(job.fixedBudgetMinor, job.currency)} fixed price`
    : `${displayMinor(job.hourlyRateMinMinor, job.currency)}–${displayMinor(job.hourlyRateMaxMinor, job.currency)} / hour`;
}

type ProposalSort = "recent" | "quote_low" | "quote_high" | "timeline";
const maxComparedProposals = 4;

function proposalStatus(proposal: Proposal): string {
  const status = (proposal as Partial<Proposal>).status;
  return typeof status === "string" && status.trim() ? status : "unknown";
}

function proposalAmount(proposal: Proposal): string {
  const fields = proposal as Partial<Proposal>;
  if (typeof fields.quoteMinor !== "string" || !/^\d+$/.test(fields.quoteMinor)) return "Quote not provided";
  if (typeof fields.currency !== "string" || !/^[A-Z]{3}$/.test(fields.currency)) return "Quote currency not provided";
  return `${displayMinor(fields.quoteMinor, fields.currency)} ${fields.currency}`;
}

function proposalTimeline(proposal: Proposal): string {
  const days = (proposal as Partial<Proposal>).timelineDays;
  return typeof days === "number" && Number.isSafeInteger(days) && days > 0 ? `${days} days` : "Timeline not provided";
}

function proposalCoverLetter(proposal: Proposal): string {
  return proposalCoverLetterValue(proposal) || "No cover letter provided.";
}

function proposalCoverLetterValue(proposal: Proposal): string | null {
  const letter = (proposal as Partial<Proposal>).coverLetter;
  return typeof letter === "string" && letter.trim() ? letter.trim() : null;
}

function proposalPortfolioSummary(proposal: Proposal): string {
  const references = (proposal as Partial<Proposal>).portfolioItemIds;
  if (!Array.isArray(references)) return "Portfolio reference information not provided.";
  if (references.length === 0) return "No portfolio references attached.";
  return `${references.length} attached; titles and links are not available in this view.`;
}

function proposalStatusLabel(proposal: Proposal): string {
  const status = proposalStatus(proposal);
  return status === "unknown" ? "Status not provided" : status.replaceAll("_", " ");
}

function proposalQuoteSortValue(proposal: Proposal): { currency: string; amount: bigint } | null {
  const fields = proposal as Partial<Proposal>;
  if (typeof fields.quoteMinor !== "string" || !/^\d+$/.test(fields.quoteMinor)
    || typeof fields.currency !== "string" || !/^[A-Z]{3}$/.test(fields.currency)) return null;
  return { currency: fields.currency, amount: BigInt(fields.quoteMinor) };
}

function proposalTimelineSortValue(proposal: Proposal): number | null {
  const value = (proposal as Partial<Proposal>).timelineDays;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function compareMissingLast<T>(left: T | null, right: T | null, compare: (a: T, b: T) => number): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compare(left, right);
}

function sortProposals(items: Proposal[], sort: ProposalSort): Proposal[] {
  return [...items].sort((left, right) => {
    if (sort === "quote_low" || sort === "quote_high") {
      const a = proposalQuoteSortValue(left);
      const b = proposalQuoteSortValue(right);
      const comparison = compareMissingLast(a, b, (first, second) => first.currency.localeCompare(second.currency)
        || (first.amount < second.amount ? -1 : first.amount > second.amount ? 1 : 0));
      if (comparison !== 0 || !a || !b) return comparison;
      if (sort === "quote_high" && a.currency === b.currency) return a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0;
      return comparison;
    }
    if (sort === "timeline") {
      const comparison = compareMissingLast(proposalTimelineSortValue(left), proposalTimelineSortValue(right), (a, b) => a - b);
      if (comparison !== 0) return comparison;
    }
    const leftDate = Date.parse((left as Partial<Proposal>).createdAt ?? "");
    const rightDate = Date.parse((right as Partial<Proposal>).createdAt ?? "");
    if (!Number.isFinite(leftDate)) return Number.isFinite(rightDate) ? 1 : 0;
    if (!Number.isFinite(rightDate)) return -1;
    return rightDate - leftDate;
  });
}

export function OpportunitiesPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [rolesUserId, setRolesUserId] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [proposalLoadFailed, setProposalLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [projectType, setProjectType] = useState("");
  const [experience, setExperience] = useState("");
  const [skill, setSkill] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState("USD");
  const [sort, setSort] = useState("recent");
  const [savedOnly, setSavedOnly] = useState(false);
  const [showJobEditor, setShowJobEditor] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobEditorStartAtPreview, setJobEditorStartAtPreview] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isCurrentUserProfile = Boolean(user && rolesUserId === user.id);
  const isFreelancer = isCurrentUserProfile && roles.includes("freelancer");
  const isClient = isCurrentUserProfile && roles.includes("client");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setSelectedJob(null);
      setProposals([]);
      setOffers([]);
      setPortfolio([]);
      setRoles([]);
      setRolesUserId(null);
      return;
    }
    let active = true;
    setLoading(true); setError("");
    setSelectedJob(null);
    setProposals([]);
    setProposalLoadFailed(false);
    const work: Array<Promise<unknown>> = [
      apiRequest<{ roles: string[]; portfolio?: PortfolioRef[] }>("/api/profile").then((profile) => {
        if (active) { setRoles(profile.roles); setPortfolio(profile.portfolio ?? []); setRolesUserId(user.id); }
      }),
      apiRequest<{ offers: Offer[] }>("/api/offers").then((response) => { if (active) setOffers(response.offers); }),
    ];
    if (jobId) {
      work.push(apiRequest<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`).then((response) => { if (active) setSelectedJob(response.job); }));
      work.push(apiRequest<{ proposals: Proposal[] }>(`/api/jobs/${encodeURIComponent(jobId)}/proposals`).then((response) => { if (active) setProposals(response.proposals); }).catch((reason: unknown) => {
        if (active) setProposalLoadFailed(true);
        throw reason;
      }));
    } else {
      work.push(apiRequest<{ jobs: Job[] }>("/api/jobs").then((response) => { if (active) setJobs(response.jobs); }));
      setSelectedJob(null); setProposals([]);
    }
    void Promise.all(work).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Marketplace records could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [jobId, refreshKey, user]);

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const searchText = `${job.title} ${job.summary} ${job.category} ${job.skills.join(" ")} ${job.requirements.join(" ")}`.toLocaleLowerCase();
    return (!search || searchText.includes(search.toLocaleLowerCase()))
      && (!category || job.category.toLocaleLowerCase() === category.toLocaleLowerCase())
      && (!projectType || job.projectType === projectType)
      && (!experience || job.experienceLevel === experience)
      && (!skill || job.skills.some((item) => item.toLocaleLowerCase().includes(skill.toLocaleLowerCase())))
      && (!budgetMin || job.currency === budgetCurrency && BigInt(job.fixedBudgetMinor ?? job.hourlyRateMaxMinor ?? "0") >= BigInt(amountMinor(budgetMin, budgetCurrency) ?? Number.MAX_SAFE_INTEGER))
      && (!budgetMax || job.currency === budgetCurrency && BigInt(job.fixedBudgetMinor ?? job.hourlyRateMinMinor ?? "0") <= BigInt(amountMinor(budgetMax, budgetCurrency) ?? -1))
      && (!savedOnly || job.isFavorite);
  }).sort((left, right) => {
    if (sort === "recent") return right.createdAt.localeCompare(left.createdAt);
    const leftAmount = BigInt(left.fixedBudgetMinor ?? left.hourlyRateMinMinor ?? "0");
    const rightAmount = BigInt(right.fixedBudgetMinor ?? right.hourlyRateMinMinor ?? "0");
    const result = leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
    return sort === "budget_low" ? result : -result;
  }), [budgetCurrency, budgetMax, budgetMin, category, experience, jobs, projectType, savedOnly, search, skill, sort]);

  const applySavedSearch = (filters: JobSearchFilters) => {
    setSearch(filters.keyword);
    setCategory(filters.category);
    setProjectType(filters.projectType);
    setExperience(filters.experience);
    setSkill(filters.skill);
    setBudgetMin(filters.budgetMin);
    setBudgetMax(filters.budgetMax);
    setBudgetCurrency(filters.budgetCurrency);
    setSort(filters.sort);
    setSavedOnly(filters.savedOnly);
  };

  const removeJobFilter = (filter: ActiveJobFilterId) => {
    if (filter === "keyword") setSearch("");
    else if (filter === "category") setCategory("");
    else if (filter === "projectType") setProjectType("");
    else if (filter === "experience") setExperience("");
    else if (filter === "skill") setSkill("");
    else if (filter === "budget") { setBudgetMin(""); setBudgetMax(""); setBudgetCurrency("USD"); }
    else if (filter === "savedOnly") setSavedOnly(false);
    else if (filter === "sort") setSort("recent");
  };

  const clearJobFilters = () => {
    setSearch(""); setCategory(""); setProjectType(""); setExperience(""); setSkill("");
    setBudgetMin(""); setBudgetMax(""); setBudgetCurrency("USD"); setSort("recent"); setSavedOnly(false);
  };

  const refresh = () => setRefreshKey((current) => current + 1);
  const toggleFavorite = async (job: Job) => {
    if (!user) return;
    setError("");
    try {
      await apiRequest(`/api/jobs/${job.id}/favorite`, { method: "POST", body: { saved: !job.isFavorite } });
      setJobs((current) => current.map((item) => item.id === job.id ? { ...item, isFavorite: !item.isFavorite } : item));
      setSelectedJob((current) => current?.id === job.id ? { ...current, isFavorite: !current.isFavorite } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The saved-job list could not be changed."); }
  };
  const changeJobStatus = async (job: Job, action: "publish" | "close" | "reopen" | "archive" | "delete") => {
    try {
      await apiRequest(`/api/jobs/${job.id}/status`, { method: "POST", body: { action } });
      setNotice(action === "delete" ? "Draft job deleted." : `Job ${action === "publish" ? "published" : action === "reopen" ? "reopened" : action + "d"}.`);
      if (action === "delete") navigate("/app/opportunities");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The job status could not be changed."); }
  };
  const persistJobDraft = async (draft: JobDraft, idempotencyKey: string, id: string | null) => {
    const validation = validateJobDraft(draft, idempotencyKey, id);
    if (!validation.payload) throw new Error(validation.issues.join(" "));
    return apiRequest<{ jobId: string }>("/api/jobs", { method: "POST", body: validation.payload });
  };
  const saveJob = async (draft: JobDraft, idempotencyKey: string, id: string | null = editingJob?.id ?? null) => {
    const result = await persistJobDraft(draft, idempotencyKey, id);
    setNotice("Job draft saved. Publish it when the listing is ready for applicants.");
    setShowJobEditor(false); setEditingJob(null); refresh();
    return result;
  };
  const completeJobPublish = () => {
    setNotice("Job published. It is now available to freelancers.");
    setShowJobEditor(false); setEditingJob(null); setJobEditorStartAtPreview(false); refresh();
  };
  const getJobStatus = async (id: string): Promise<Job["status"]> => {
    const response = await apiRequest<{ job: Job }>(`/api/jobs/${encodeURIComponent(id)}`);
    return response.job.status;
  };
  const publishJob = async (id: string) => {
    try {
      await apiRequest(`/api/jobs/${id}/status`, { method: "POST", body: { action: "publish" } });
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "The publishing request failed.";
      let status: Job["status"];
      try { status = await getJobStatus(id); }
      catch {
        throw new PublishOutcomeUnclearError(`The publish request did not return a result, and the listing status could not be verified. Do not retry until you verify its status. ${detail}`);
      }
      if (status === "published") {
        completeJobPublish();
        return;
      }
      if (status !== "draft") {
        throw new PublishOutcomeUnclearError(`The listing is currently ${status}. Publishing is blocked until its status can be verified as a draft. ${detail}`);
      }
      throw new Error(`The listing status was verified as draft, so publishing can be safely retried. Your details are still here. ${detail}`);
    }
    completeJobPublish();
  };
  const verifyJobPublishStatus = async (id: string) => {
    const status = await getJobStatus(id);
    if (status === "published") completeJobPublish();
    return status;
  };

  const updateProposal = async (proposalId: string, action: "submit" | "withdraw" | "shortlist" | "reject" | "invite_interview"): Promise<boolean> => {
    try {
      await apiRequest(`/api/proposals/${proposalId}/transition`, { method: "POST", body: { action } });
      setNotice(action === "invite_interview" ? "Interview status recorded. No notification was sent because messaging is not available yet." : `Proposal ${action === "submit" ? "submitted" : action === "withdraw" ? "withdrawn" : action === "shortlist" ? "shortlisted" : "rejected"}.`);
      refresh();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Proposal status could not be changed."); return false; }
  };

  const submitOffer = async (proposal: Proposal, input: { terms: string; amount: string; timeline: string; key: string }) => {
    const currency = selectedJob?.currency ?? proposal.currency;
    const amount = amountMinor(input.amount, currency);
    if (amount === null || !Number.isSafeInteger(Number(input.timeline)) || Number(input.timeline) < 1) throw new Error("Enter a positive exact offer amount and delivery timeline.");
    await apiRequest(`/api/proposals/${proposal.id}/offers`, { method: "POST", body: {
      idempotencyKey: input.key, terms: input.terms, amountMinor: amount,
      currency, timelineDays: Number(input.timeline),
    } });
    setNotice("Offer sent. The freelancer must explicitly accept or decline it.");
    refresh();
  };

  const respondOffer = async (offer: Offer, decision: "accept" | "decline") => {
    try {
      const response = await apiRequest<{ status: string; projectId?: string | null; contractType?: "fixed" | "hourly" | null }>(`/api/offers/${offer.id}/respond`, { method: "POST", body: { decision } });
      if (response.projectId) {
        setNotice(response.contractType === "hourly"
          ? "Hourly offer accepted. The rate agreement is ready for both parties to review; time tracking unlocks after dual approval."
          : "Offer accepted. A draft project and agreement were created; both parties still need to review and approve the terms.");
        navigate(`/app/projects/${response.projectId}`);
      } else setNotice("Offer declined.");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The offer response could not be saved."); }
  };

  if (!user) return <>
    <PageHeading eyebrow="FREELANCE MARKETPLACE" title="Opportunities" description="Explore fixed-price and hourly work, apply with a scoped proposal, and keep hiring decisions attached to the agreement." />
    <div className="marketplace-empty"><BriefcaseBusiness size={24} /><h2>Sign in to browse persisted jobs</h2><p>Sample workspace records are not presented as live marketplace listings.</p><Link className="button-primary" to="/signin">Sign in <ArrowUpRight size={14} /></Link></div>
  </>;

  return <>
    <PageHeading eyebrow="FREELANCE MARKETPLACE" title={jobId ? "Opportunity details" : "Find your next opportunity"} description="Browse persisted listings, compare terms, and keep proposals and offer decisions attached to the job." action={!jobId && isClient ? <button className="button-primary" type="button" onClick={() => { setEditingJob(null); setJobEditorStartAtPreview(false); setShowJobEditor((open) => !open); }}><Plus size={15} /> Post a job</button> : undefined} />
    {error && <p className="marketplace-alert" role="alert"><CircleAlert size={15} />{error}</p>}
    {notice && <p className="marketplace-notice" role="status"><Check size={15} />{notice}</p>}
    {showJobEditor && <JobEditor key={`${editingJob?.id ?? "new-job"}:${jobEditorStartAtPreview ? "preview" : "edit"}`} initial={editingJob} startAtPreview={jobEditorStartAtPreview}
      onCancel={() => { setShowJobEditor(false); setEditingJob(null); setJobEditorStartAtPreview(false); }}
      onSaveDraft={(draft, key) => saveJob(draft, key, editingJob?.id ?? null)}
      onPersistDraft={persistJobDraft} onPublish={publishJob} onVerifyPublishStatus={verifyJobPublishStatus} />}
    {jobId ? <>
      <Link className="marketplace-back" to="/app/opportunities"><ArrowLeft size={14} /> Back to opportunities</Link>
      {loading ? <div className="marketplace-empty" role="status" aria-busy="true">Loading job and proposal details…</div> : selectedJob ? <JobDetail
        job={selectedJob} isClient={isClient} isFreelancer={isFreelancer} proposals={proposals} offers={offers.filter((offer) => offer.jobId === selectedJob.id)} portfolio={portfolio}
        onFavorite={() => void toggleFavorite(selectedJob)} onChangeStatus={(action) => void changeJobStatus(selectedJob, action)}
        onProposal={async (body, submit) => {
          const result = await apiRequest<{ proposalId: string }>(`/api/jobs/${selectedJob.id}/proposals`, { method: "POST", body });
          if (submit) {
            if (!(await updateProposal(result.proposalId, "submit"))) throw new Error("Your draft was saved, but the proposal was not submitted. Review the message and retry.");
          } else { setNotice("Proposal draft saved to your account."); refresh(); }
        }}
        onTransition={(proposalId, action) => void updateProposal(proposalId, action)}
        onOffer={submitOffer} proposalLoadFailed={proposalLoadFailed} onRetry={refresh}
        onRespondOffer={respondOffer}
        onReport={async (reason, details) => {
          await apiRequest(`/api/jobs/${selectedJob.id}/reports`, { method: "POST", body: { reason, details } });
          setNotice("Report sent for review. It is private to you and marketplace administrators.");
        }}
        onEdit={(mode = "edit") => { setEditingJob(selectedJob); setJobEditorStartAtPreview(mode === "preview"); setShowJobEditor(true); }}
      /> : error ? <div className="marketplace-empty"><h2>Job details unavailable</h2><p>This listing could not be loaded. It may be private, closed, or unavailable to your account.</p><button className="button-secondary" type="button" onClick={refresh}>Retry loading job</button></div>
        : <div className="marketplace-empty"><h2>Job not found</h2><p>This listing may have been removed or is no longer available.</p><Link to="/app/opportunities">Browse open jobs</Link></div>}
    </> : <>
      {isClient && <div className="marketplace-role-note"><strong>Client account</strong><span>Post and manage a job listing. Review applicants and send offers from the job details.</span></div>}
      <section className="marketplace-toolbar">
        <label className="marketplace-search"><Search size={16} /><input id="marketplace-job-search" aria-label="Search jobs" placeholder="Search roles, skills, or requirements" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label="Category filter" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{category && !jobs.some((job) => job.category === category) && <option value={category}>Previously saved: {category}</option>}{[...new Set(jobs.map((job) => job.category))].sort().map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="Project type filter" value={projectType} onChange={(event) => setProjectType(event.target.value)}><option value="">Fixed or hourly</option><option value="fixed">Fixed price</option><option value="hourly">Hourly</option></select>
        <select aria-label="Experience filter" value={experience} onChange={(event) => setExperience(event.target.value)}><option value="">Any experience</option><option value="entry">Entry level</option><option value="intermediate">Intermediate</option><option value="expert">Expert</option></select>
        <input aria-label="Skill filter" value={skill} onChange={(event) => setSkill(event.target.value)} placeholder="Skill" />
        <label className="marketplace-budget-filter"><span>Budget range ({budgetCurrency})</span><input aria-label="Minimum budget" inputMode="decimal" value={budgetMin} onChange={(event) => setBudgetMin(event.target.value)} placeholder="Min" /><input aria-label="Maximum budget" inputMode="decimal" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} placeholder="Max" /><input aria-label="Budget currency" maxLength={3} pattern="[A-Z]{3}" value={budgetCurrency} onChange={(event) => setBudgetCurrency(event.target.value.toUpperCase())} /></label>
        <select aria-label="Sort jobs" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Most recent</option><option value="budget_low">Budget: low to high</option><option value="budget_high">Budget: high to low</option></select>
        {isFreelancer && <button className={`marketplace-filter-chip${savedOnly ? " selected" : ""}`} type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(!savedOnly)}><Bookmark size={13} /> Saved jobs</button>}
      </section>
      <ActiveJobFilterChips
        filters={{ keyword: search, category, projectType, experience, skill, budgetMin, budgetMax, budgetCurrency, sort, savedOnly }}
        onRemove={removeJobFilter}
        onClearFilters={clearJobFilters}
      />
      {isFreelancer && user?.id && <SavedJobSearchPresets key={user.id} userId={user.id} filters={{ keyword: search, category, projectType: projectType as JobSearchFilters["projectType"], experience: experience as JobSearchFilters["experience"], skill, budgetMin, budgetMax, budgetCurrency, sort: sort as JobSearchFilters["sort"], savedOnly }} onApply={applySavedSearch} />}
      {loading ? <div className="marketplace-empty" role="status">Loading marketplace listings…</div> : filteredJobs.length ? <div className="marketplace-job-list">{filteredJobs.map((job) => <article className="marketplace-job-card" key={job.id}>
        <div className="marketplace-job-top"><div><span className="marketplace-category">{job.category} · {job.experienceLevel}</span><h2><Link to={`/app/opportunities/${job.id}`}>{job.title}<ArrowUpRight size={14} /></Link></h2><p>{job.summary}</p></div><strong className="marketplace-budget">{jobBudget(job)}</strong></div>
        <div className="marketplace-job-tags">{job.skills.slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}</div>
        <div className="marketplace-job-bottom"><span>{job.status === "published" ? "Open for proposals" : job.status.replaceAll("_", " ")} · {job.estimatedDays ? `${job.estimatedDays} day estimate` : "Timeline to discuss"}</span><div>{isFreelancer && job.status === "published" && <button className={`marketplace-icon-action${job.isFavorite ? " saved" : ""}`} type="button" aria-label={job.isFavorite ? "Remove saved job" : "Save job"} onClick={() => void toggleFavorite(job)}><Bookmark size={15} fill={job.isFavorite ? "currentColor" : "none"} /></button>}<Link className="marketplace-open-link" to={`/app/opportunities/${job.id}`}>View details <ArrowUpRight size={13} /></Link></div></div>
      </article>)}</div> : <div className="marketplace-empty"><Search size={22} /><h2>{jobs.length ? "No matching jobs" : "No marketplace jobs yet"}</h2><p>{jobs.length ? "Adjust a filter to look at more listings." : isClient ? "Post a draft listing, review its details, then publish it for applicants." : "Published opportunities will appear here when clients post jobs."}</p></div>}
      {offers.length > 0 && <section className="marketplace-offers-panel"><div className="marketplace-section-heading"><div><span className="eyebrow">YOUR INBOX</span><h2>Offers</h2></div><span>{offers.filter((offer) => offer.isRecipient && offer.status === "sent").length} awaiting your response</span></div>{offers.map((offer) => <OfferRow key={offer.id} offer={offer} onRespond={respondOffer} />)}</section>}
    </>}
  </>;
}

type JobEditorStage = "edit" | "preview" | "confirm";
type PersistedJob = { jobId: string };

function JobEditor({ initial, startAtPreview, onCancel, onSaveDraft, onPersistDraft, onPublish, onVerifyPublishStatus }: {
  initial: Job | null; startAtPreview: boolean; onCancel: () => void;
  onSaveDraft: (draft: JobDraft, key: string) => Promise<unknown>;
  onPersistDraft: (draft: JobDraft, key: string, id: string | null) => Promise<PersistedJob>;
  onPublish: (id: string) => Promise<void>;
  onVerifyPublishStatus: (id: string) => Promise<Job["status"]>;
}) {
  const [draft, setDraft] = useState<JobDraft>(() => initial ? {
    title: initial.title, summary: initial.summary, description: initial.description, requirements: initial.requirements.join("\n"),
    skills: initial.skills.join(", "), category: initial.category, experienceLevel: initial.experienceLevel, projectType: initial.projectType,
    fixedBudget: initial.fixedBudgetMinor ? minorToText(initial.fixedBudgetMinor, initial.currency) : "",
    hourlyMin: initial.hourlyRateMinMinor ? minorToText(initial.hourlyRateMinMinor, initial.currency) : "",
    hourlyMax: initial.hourlyRateMaxMinor ? minorToText(initial.hourlyRateMaxMinor, initial.currency) : "",
    currency: initial.currency, estimatedDays: initial.estimatedDays ? String(initial.estimatedDays) : "",
  } : emptyJobDraft());
  const [key] = useState(() => crypto.randomUUID());
  const [stage, setStage] = useState<JobEditorStage>(() => startAtPreview ? "preview" : "edit");
  const [busy, setBusy] = useState(false);
  const [publishOutcomeUnclear, setPublishOutcomeUnclear] = useState(false);
  const [message, setMessage] = useState("");
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [persistedJobId, setPersistedJobId] = useState<string | null>(initial?.id ?? null);
  const publishLock = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreEditFocus = useRef(false);
  const change = (field: keyof JobDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setMessage("");
  };
  useEffect(() => {
    if (stage === "edit" && restoreEditFocus.current) {
      titleInputRef.current?.focus();
      restoreEditFocus.current = false;
    } else if (stage !== "edit") stageHeadingRef.current?.focus();
  }, [stage]);
  const openPreview = () => {
    const validation = validateJobDraft(draft, key, persistedJobId);
    setValidationIssues(validation.issues);
    setMessage("");
    setStage("preview");
  };
  const returnToEdit = () => { restoreEditFocus.current = true; setStage("edit"); };
  const continueToConfirmation = () => {
    const validation = validateJobDraft(draft, key, persistedJobId);
    setValidationIssues(validation.issues);
    if (validation.issues.length) return;
    setMessage("");
    setStage("confirm");
  };
  const saveDraft = async () => {
    setBusy(true); setMessage("");
    try { await onSaveDraft(draft, key); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The job draft could not be saved."); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (publishLock.current) return;
    const validation = validateJobDraft(draft, key, persistedJobId);
    setValidationIssues(validation.issues);
    if (validation.issues.length) { setStage("preview"); return; }
    publishLock.current = true;
    setBusy(true); setMessage("");
    try {
      const saved = await onPersistDraft(draft, key, persistedJobId);
      setPersistedJobId(saved.jobId);
      await onPublish(saved.jobId);
    } catch (reason) {
      publishLock.current = false;
      setPublishOutcomeUnclear(reason instanceof PublishOutcomeUnclearError);
      setMessage(reason instanceof Error ? reason.message : "The listing could not be published. Your draft is still available to retry.");
    } finally { setBusy(false); }
  };
  const verifyPublishStatus = async () => {
    if (!persistedJobId || busy) return;
    setBusy(true); setMessage("");
    try {
      const status = await onVerifyPublishStatus(persistedJobId);
      if (status === "published") return;
      if (status === "draft") {
        setPublishOutcomeUnclear(false);
        setMessage("Status verified: this listing is still a draft. You can safely retry publishing.");
        return;
      }
      setMessage(`Status verified as ${status}. Publishing remains blocked until the listing is a draft.`);
    } catch (reason) {
      setMessage(`The listing status still could not be verified. Do not retry publishing yet. ${reason instanceof Error ? reason.message : "Please try status verification again."}`);
    } finally { setBusy(false); }
  };
  const experienceText = draft.experienceLevel === "entry" ? "Entry level" : draft.experienceLevel === "expert" ? "Expert" : "Intermediate";
  const requirements = splitLines(draft.requirements);
  const skills = splitLines(draft.skills);
  const currencyLabel = draft.currency.trim() || "Currency not provided";
  const amountLabel = (value: string) => {
    const amount = amountMinor(value, draft.currency);
    return amount !== null && /^[A-Z]{3}$/.test(draft.currency)
      ? displayMinor(String(amount), draft.currency)
      : value.trim() || "Not provided";
  };
  const budgetText = draft.projectType === "fixed"
    ? `${amountLabel(draft.fixedBudget)} ${currencyLabel} fixed price`
    : `${amountLabel(draft.hourlyMin)}–${amountLabel(draft.hourlyMax)} ${currencyLabel} / hour`;
  return <section className="surface-card marketplace-editor" aria-labelledby="job-editor-heading">
    <div className="marketplace-editor-heading"><div><span className="eyebrow">CLIENT JOB POST</span><h2 id="job-editor-heading">{stage === "edit" ? initial ? "Edit listing" : "Describe the work clearly" : stage === "preview" ? "Preview your job listing" : "Confirm publishing"}</h2><p>{stage === "edit" ? "Review the listing before publishing. It remains a draft until you confirm." : stage === "preview" ? "This is how the listing details will appear to freelancers." : "Publishing makes this listing visible to freelancers who can apply."}</p></div><button className="marketplace-icon-action" type="button" aria-label="Close job form" disabled={busy || publishOutcomeUnclear} onClick={onCancel}><X size={15} /></button></div>
    {stage === "edit" && <form className="marketplace-form" noValidate onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); openPreview(); }}>
      <label>Job title<input ref={titleInputRef} required minLength={5} maxLength={160} value={draft.title} onChange={(event) => change("title", event.target.value)} placeholder="e.g. Build an appointment scheduling website" /></label>
      <label>Short summary<input required minLength={10} maxLength={240} value={draft.summary} onChange={(event) => change("summary", event.target.value)} /></label>
      <label>Full description<textarea required minLength={30} maxLength={8000} rows={5} value={draft.description} onChange={(event) => change("description", event.target.value)} /></label>
      <div className="marketplace-form-grid"><label>Category<input required minLength={2} maxLength={80} value={draft.category} onChange={(event) => change("category", event.target.value)} placeholder="Development & technology" /></label><label>Experience<select value={draft.experienceLevel} onChange={(event) => change("experienceLevel", event.target.value)}><option value="entry">Entry level</option><option value="intermediate">Intermediate</option><option value="expert">Expert</option></select></label></div>
      <label>Requirements <span className="field-hint">One per line</span><textarea required rows={3} value={draft.requirements} onChange={(event) => change("requirements", event.target.value)} placeholder="Responsive layout\nAccessible keyboard navigation" /></label>
      <div className="marketplace-form-grid"><label>Skills <span className="field-hint">Comma separated</span><input value={draft.skills} onChange={(event) => change("skills", event.target.value)} placeholder="React, TypeScript" /></label><label>Project type<select value={draft.projectType} onChange={(event) => change("projectType", event.target.value)}><option value="fixed">Fixed price</option><option value="hourly">Hourly</option></select></label></div>
      {draft.projectType === "fixed" ? <label>Fixed budget ({draft.currency})<input required inputMode="decimal" placeholder="600.00" value={draft.fixedBudget} onChange={(event) => change("fixedBudget", event.target.value)} /></label> : <div className="marketplace-form-grid"><label>Minimum hourly rate ({draft.currency})<input required inputMode="decimal" value={draft.hourlyMin} onChange={(event) => change("hourlyMin", event.target.value)} /></label><label>Maximum hourly rate ({draft.currency})<input required inputMode="decimal" value={draft.hourlyMax} onChange={(event) => change("hourlyMax", event.target.value)} /></label></div>}
      <div className="marketplace-form-grid"><label>Currency<input required maxLength={3} pattern="[A-Z]{3}" value={draft.currency} onChange={(event) => change("currency", event.target.value.toUpperCase())} /></label><label>Estimated duration in days<input type="number" min="1" max="3650" value={draft.estimatedDays} onChange={(event) => change("estimatedDays", event.target.value)} placeholder="Optional" /></label></div>
      {message && <p className="marketplace-inline-error" role="alert">{message}</p>}
      <div className="marketplace-form-actions"><button className="button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button-secondary" type="button" disabled={busy} onClick={() => void saveDraft()}>{busy ? "Working…" : initial ? "Save draft changes" : "Save job draft"}</button><button className="button-primary" type="submit" disabled={busy}>Preview listing <ArrowUpRight size={14} /></button></div>
    </form>}
    {stage === "preview" && <div className="marketplace-job-preview">
      <h3 ref={stageHeadingRef} tabIndex={-1}>Freelancer listing preview</h3>
      <p className="marketplace-preview-note">Preview only. Opening this screen has not created or published a job.</p>
      <article className="marketplace-job-card marketplace-job-preview-card">
        <div className="marketplace-job-top"><div><span className="marketplace-category">{draft.category.trim() || "Category not provided"} · {experienceText}</span><h2>{draft.title.trim() || "Job title not provided"}</h2><p>{draft.summary.trim() || "Short summary not provided"}</p></div><strong className="marketplace-budget">{budgetText}</strong></div>
        <div className="marketplace-job-bottom"><span>{draft.projectType === "fixed" ? "Fixed price" : "Hourly"} · {draft.estimatedDays.trim() ? `${draft.estimatedDays} day estimate` : "Timeline not specified"}</span><span>Draft preview</span></div>
        <div className="marketplace-detail-section"><h4>About this project</h4><p>{draft.description.trim() || "Description not provided"}</p></div>
        <div className="marketplace-detail-section"><h4>Requirements</h4>{requirements.length ? <ul>{requirements.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>Requirements not provided.</p>}</div>
        <div className="marketplace-detail-section"><h4>Skills</h4>{skills.length ? <div className="marketplace-job-tags">{skills.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}</div> : <p>No skills provided.</p>}</div>
      </article>
      {validationIssues.length > 0 && <div className="marketplace-job-validation" role="alert" aria-labelledby="job-validation-heading"><h4 id="job-validation-heading">Complete these fields before publishing</h4><ul>{validationIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></div>}
      {message && <p className="marketplace-inline-error" role="alert">{message}</p>}
      <div className="marketplace-form-actions"><button className="button-secondary" type="button" disabled={publishOutcomeUnclear} onClick={returnToEdit}>Back to edit</button><button className="button-primary" type="button" disabled={busy || validationIssues.length > 0} onClick={continueToConfirmation}>Continue to publish confirmation <ArrowUpRight size={14} /></button></div>
    </div>}
    {stage === "confirm" && <div className="marketplace-job-confirmation">
      <h3 ref={stageHeadingRef} tabIndex={-1}>Ready to publish?</h3>
      <p>Publish <strong>{draft.title.trim()}</strong> as a {draft.projectType === "fixed" ? "fixed-price" : "hourly"} job. Freelancers will be able to view the listing and submit proposals.</p>
      <dl><div><dt>Category</dt><dd>{draft.category.trim()}</dd></div><div><dt>Budget</dt><dd>{budgetText}</dd></div><div><dt>Experience</dt><dd>{experienceText}</dd></div><div><dt>Estimated duration</dt><dd>{draft.estimatedDays.trim() ? `${draft.estimatedDays} days` : "Not specified"}</dd></div></dl>
      <p className="marketplace-preview-note">You are confirming that this listing is ready for applicants.</p>
      {message && <p className="marketplace-inline-error" role="alert">{message}</p>}
      {busy && <p className="marketplace-inline-note" role="status" aria-live="polite">Saving the draft and publishing the listing…</p>}
      {publishOutcomeUnclear && <button className="button-secondary" type="button" disabled={busy} onClick={() => void verifyPublishStatus()}>{busy ? "Verifying status…" : "Verify publish status"}</button>}
      <div className="marketplace-form-actions"><button className="button-secondary" type="button" disabled={busy || publishOutcomeUnclear} onClick={() => setStage("preview")}>Back to preview</button><button className="button-primary" type="button" disabled={busy || publishOutcomeUnclear} onClick={() => void publish()}>{busy ? "Publishing…" : "Confirm and publish job"} <Check size={14} /></button></div>
    </div>}
  </section>;
}

function minorToText(value: string, currency: string) {
  if (!/^\d+$/.test(value)) return "";
  const digits = currencyDigits(currency); const divisor = 10n ** BigInt(digits); const minor = BigInt(value);
  return digits ? `${minor / divisor}.${(minor % divisor).toString().padStart(digits, "0")}` : `${minor}`;
}

function JobDetail({
  job, isClient, isFreelancer, proposals, offers, portfolio, onFavorite, onChangeStatus, onProposal, onTransition, onOffer, onRespondOffer, onReport, onEdit, proposalLoadFailed, onRetry,
}: {
  job: Job; isClient: boolean; isFreelancer: boolean; proposals: Proposal[]; offers: Offer[]; portfolio: PortfolioRef[];
  onFavorite: () => void; onChangeStatus: (action: "publish" | "close" | "reopen" | "archive" | "delete") => void;
  onProposal: (body: unknown, submit: boolean) => Promise<void>;
  onTransition: (proposalId: string, action: "submit" | "withdraw" | "shortlist" | "reject" | "invite_interview") => void;
  onOffer: (proposal: Proposal, input: { terms: string; amount: string; timeline: string; key: string }) => Promise<void>;
  onRespondOffer: (offer: Offer, decision: "accept" | "decline") => void;
  onReport: (reason: string, details: string) => Promise<void>; onEdit: (mode?: "edit" | "preview") => void; proposalLoadFailed: boolean; onRetry: () => void;
}) {
  const owner = job.isOwner === true;
  const proposalsForJob = proposals.filter((proposal) => proposal.jobId === job.id);
  const ownProposal = proposalsForJob.find((proposal) => proposal.isMine);
  const [coverLetter, setCoverLetter] = useState(ownProposal?.coverLetter ?? "");
  const [quote, setQuote] = useState(ownProposal ? minorToText(ownProposal.quoteMinor, job.currency) : "");
  const [timeline, setTimeline] = useState(ownProposal ? String(ownProposal.timelineDays) : "14");
  const [selectedPortfolio, setSelectedPortfolio] = useState<string[]>(ownProposal?.portfolioItemIds ?? []);
  const [reviewingProposal, setReviewingProposal] = useState(false);
  const restoreEditingFocus = useRef(false);
  const coverLetterRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("suspicious");
  const [reportDetails, setReportDetails] = useState("");
  const relevantOffers = offers;
  const canEditProposal = job.status === "published" && (!ownProposal || ownProposal.status === "draft");
  const showProposal = !owner && isFreelancer && (job.status === "published" || Boolean(ownProposal));
  useEffect(() => {
    if (!ownProposal) return;
    setCoverLetter(ownProposal.coverLetter);
    setQuote(minorToText(ownProposal.quoteMinor, job.currency));
    setTimeline(String(ownProposal.timelineDays));
    setSelectedPortfolio(ownProposal.portfolioItemIds);
  }, [job.currency, ownProposal?.id, ownProposal?.coverLetter, ownProposal?.quoteMinor, ownProposal?.timelineDays, ownProposal?.portfolioItemIds]);
  useEffect(() => {
    if (!reviewingProposal && restoreEditingFocus.current) {
      coverLetterRef.current?.focus();
      restoreEditingFocus.current = false;
    }
  }, [reviewingProposal]);
  const changePortfolio = (id: string, checked: boolean) => setSelectedPortfolio((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  const proposalQuoteMinor = amountMinor(quote, job.currency);
  const saveProposal = async (submit: boolean) => {
    setMessage("");
    try {
      await onProposal({ coverLetter, quoteMinor: amountMinor(quote, job.currency), timelineDays: Number(timeline), portfolioItemIds: selectedPortfolio }, submit);
      setMessage(submit ? "Proposal submitted to the client." : "Proposal draft saved.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Proposal could not be saved."); }
  };
  return <>
    <article className="marketplace-detail-card">
      <div className="marketplace-detail-top"><div><span className="marketplace-category">{job.category} · {job.experienceLevel}</span><h1>{job.title}</h1><p>{job.summary}</p></div><strong className="marketplace-budget">{jobBudget(job)}</strong></div>
      <div className="marketplace-detail-meta"><StatusPill status={job.status} /><span>{job.estimatedDays ? `Estimated ${job.estimatedDays} days` : "Timeline to discuss"}</span><span>Posted {new Date(job.createdAt).toLocaleDateString()}</span>{job.status === "published" && isFreelancer && <button type="button" className={`marketplace-outline-action${job.isFavorite ? " selected" : ""}`} onClick={onFavorite}><Bookmark size={14} />{job.isFavorite ? "Saved" : "Save job"}</button>}</div>
      {owner && isClient && <div className="marketplace-owner-actions">{job.status === "draft" && <><button type="button" className="button-secondary" onClick={() => onEdit("edit")}>Edit draft</button><button type="button" className="button-primary" onClick={() => onEdit("preview")}>Preview &amp; publish</button><button type="button" className="marketplace-text-action" onClick={() => { if (window.confirm("Delete this draft listing? This action cannot be undone.")) onChangeStatus("delete"); }}>Delete draft</button></>}{job.status === "published" && <button type="button" className="button-secondary" onClick={() => onChangeStatus("close")}>Close applications</button>}{job.status === "closed" && <><button type="button" className="button-secondary" onClick={() => onChangeStatus("reopen")}>Reopen job</button><button type="button" className="button-secondary" onClick={() => onChangeStatus("archive")}>Archive</button></>}</div>}
      <div className="marketplace-detail-section"><h2>About this project</h2><p>{job.description}</p></div>
      {job.requirements.length > 0 && <div className="marketplace-detail-section"><h2>Requirements</h2><ul>{job.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></div>}
      {job.skills.length > 0 && <div className="marketplace-detail-section"><h2>Skills</h2><div className="marketplace-job-tags">{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div>}
      {showProposal && <section className="marketplace-proposal-box"><div className="marketplace-section-heading"><div><span className="eyebrow">YOUR APPLICATION</span><h2>{canEditProposal ? ownProposal ? "Update your proposal" : "Send a thoughtful proposal" : "Application record"}</h2></div>{ownProposal && <StatusPill status={ownProposal.status} />}</div>
        {canEditProposal ? reviewingProposal ? <FreelancerProposalReview
          coverLetter={coverLetter}
          quoteText={quote}
          quoteMinor={proposalQuoteMinor}
          quotePreview={proposalQuoteMinor === null ? "" : displayMinor(String(proposalQuoteMinor), job.currency)}
          currency={job.currency}
          timelineText={timeline}
          timelineDays={Number(timeline)}
          portfolioItemIds={selectedPortfolio}
          portfolio={portfolio}
          onEdit={() => { restoreEditingFocus.current = true; setReviewingProposal(false); }}
          onRemoveUnavailableReference={(id) => setSelectedPortfolio((current) => current.filter((item) => item !== id))}
          onConfirm={(input) => onProposal(input, true)}
        /> : <form className="marketplace-form" onSubmit={(event) => { event.preventDefault(); void saveProposal(false); }}>
          <label>Cover letter<textarea ref={coverLetterRef} required minLength={30} maxLength={5000} rows={5} value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} placeholder="Explain how you would approach the requirements and what you would deliver." /></label>
          <div className="marketplace-form-grid"><label>Your quote ({job.currency})<input required inputMode="decimal" value={quote} onChange={(event) => setQuote(event.target.value)} /></label><label>Expected timeline (days)<input required type="number" min="1" max="3650" value={timeline} onChange={(event) => setTimeline(event.target.value)} /></label></div>
          {portfolio.length > 0 && <fieldset className="marketplace-reference-list"><legend>Portfolio references <span className="field-hint">Choose only work you may share</span></legend>{portfolio.map((item) => <label key={item.id}><input type="checkbox" checked={selectedPortfolio.includes(item.id)} onChange={(event) => changePortfolio(item.id, event.target.checked)} /> {item.title}</label>)}</fieldset>}
          {ownProposal?.status === "draft" ? <div className="marketplace-form-actions"><button className="button-secondary" type="submit">Save draft</button><button className="button-primary" type="button" onClick={() => { setMessage(""); setReviewingProposal(true); }}>Review proposal <Send size={14} /></button></div> : <div className="marketplace-form-actions"><button className="button-secondary" type="submit">Save proposal draft</button><button className="button-primary" type="button" onClick={() => { setMessage(""); setReviewingProposal(true); }}>Review proposal <Send size={14} /></button></div>}
          {message && <p role="status" className="marketplace-inline-note">{message}</p>}
        </form> : <div className="marketplace-submitted-proposal"><p>{ownProposal?.coverLetter ?? "Your draft is saved, but this job is no longer open for new proposals."}</p>{ownProposal && <div className="marketplace-detail-meta"><strong>{displayMinor(ownProposal.quoteMinor, ownProposal.currency)}</strong><span>{ownProposal.timelineDays} day estimate</span><span>{ownProposal.portfolioItemIds.length} portfolio reference(s)</span></div>}{ownProposal && ["submitted", "shortlisted", "interview_invited"].includes(ownProposal.status) && <button className="marketplace-text-action" type="button" onClick={() => onTransition(ownProposal.id, "withdraw")}>Withdraw proposal</button>}{ownProposal?.status === "withdrawn" && <p className="marketplace-inline-note">This application was withdrawn. The one-application-per-job rule prevents a duplicate application.</p>}</div>}
      </section>}
      <ProposalReviewPanel key={job.id} jobId={job.id} jobTitle={job.title} jobCurrency={job.currency} proposals={proposalsForJob}
        proposalLoadFailed={proposalLoadFailed} clientCanReview={owner && isClient} onRetry={onRetry}
        onTransition={onTransition} onOffer={onOffer} />
      {!owner && isFreelancer && job.status === "published" && <button className="marketplace-text-action marketplace-report-toggle" type="button" onClick={() => setReportOpen(!reportOpen)}><Flag size={13} /> Report a suspicious listing</button>}
      {reportOpen && <form className="marketplace-report-form" onSubmit={(event) => { event.preventDefault(); void onReport(reportReason, reportDetails).then(() => { setReportOpen(false); setMessage("Thank you. The report was recorded for administrator review."); }).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "The report could not be sent.")); }}><label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="suspicious">Suspicious activity</option><option value="misleading">Misleading listing</option><option value="prohibited">Prohibited work</option><option value="other">Other</option></select></label><label>Details<textarea maxLength={2000} rows={3} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} /></label><button className="button-secondary">Send private report</button>{message && <span role="status">{message}</span>}</form>}
    </article>
    {relevantOffers.length > 0 && <section className="marketplace-offers-panel"><div className="marketplace-section-heading"><div><span className="eyebrow">JOB OFFERS</span><h2>Offer decisions</h2></div></div>{relevantOffers.map((offer) => <OfferRow key={offer.id} offer={offer} onRespond={onRespondOffer} />)}</section>}
  </>;
}

export function ProposalReviewPanel({
  jobId, jobTitle, jobCurrency, proposals, proposalLoadFailed, clientCanReview, onRetry, onTransition, onOffer,
}: {
  jobId: string; jobTitle: string; jobCurrency: string; proposals: Proposal[]; proposalLoadFailed: boolean; clientCanReview: boolean;
  onRetry: () => void;
  onTransition: (proposalId: string, action: "submit" | "withdraw" | "shortlist" | "reject" | "invite_interview") => void;
  onOffer: (proposal: Proposal, input: { terms: string; amount: string; timeline: string; key: string }) => Promise<void>;
}) {
  const [sort, setSort] = useState<ProposalSort>("recent");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [offerForm, setOfferForm] = useState<Record<string, { terms: string; amount: string; timeline: string; key: string }>>({});
  const offerKeys = useRef(new Map<string, string>());
  const [message, setMessage] = useState("");
  const jobProposals = proposals.filter((proposal) => proposal.jobId === jobId);
  const proposalIds = new Set(jobProposals.map((proposal) => proposal.id));
  const activeSelectedIds = selectedIds.filter((id) => proposalIds.has(id));
  const visibleProposals = sortProposals(jobProposals.filter((proposal) => statusFilter === "all" || proposalStatus(proposal) === statusFilter), sort);
  const selectedProposals = activeSelectedIds.map((id) => jobProposals.find((proposal) => proposal.id === id)).filter((proposal): proposal is Proposal => Boolean(proposal));
  const printableProposals: PrintableProposalSummary[] = selectedProposals.map((proposal) => ({
    amount: proposalAmount(proposal),
    timeline: proposalTimeline(proposal),
    status: proposalStatusLabel(proposal),
    coverLetter: proposalCoverLetterValue(proposal),
    portfolioReferences: proposalPortfolioSummary(proposal),
  }));
  const maxReached = selectedProposals.length >= maxComparedProposals;
  const initialOffer = (proposal: Proposal) => {
    const existing = offerForm[proposal.id];
    if (existing) return existing;
    let key = offerKeys.current.get(proposal.id);
    if (!key) { key = crypto.randomUUID(); offerKeys.current.set(proposal.id, key); }
    const fields = proposal as Partial<Proposal>;
    const currency = typeof fields.currency === "string" ? fields.currency : jobCurrency;
    const quoteMinor = typeof fields.quoteMinor === "string" ? fields.quoteMinor : "";
    const timelineDays = typeof fields.timelineDays === "number" ? String(fields.timelineDays) : "";
    return { terms: "", amount: minorToText(quoteMinor, currency), timeline: timelineDays, key };
  };
  const patchOffer = (proposal: Proposal, field: "terms" | "amount" | "timeline", value: string) => setOfferForm((current) => ({
    ...current, [proposal.id]: { ...initialOffer(proposal), [field]: value },
  }));
  const selectProposal = (proposal: Proposal, checked: boolean) => {
    if (!clientCanReview || proposal.jobId !== jobId || !proposalIds.has(proposal.id)) return;
    setSelectedIds((current) => {
      const active = current.filter((id) => proposalIds.has(id));
      if (!checked) return active.filter((id) => id !== proposal.id);
      if (active.includes(proposal.id) || active.length >= maxComparedProposals) return active;
      return [...active, proposal.id];
    });
  };
  const removeFromComparison = (proposalId: string) => setSelectedIds((current) => current.filter((id) => id !== proposalId));

  if (!clientCanReview) return null;
  return <section className="marketplace-proposal-box" aria-labelledby="proposal-review-heading">
    <div className="marketplace-section-heading"><div><span className="eyebrow">APPLICANTS</span><h2 id="proposal-review-heading">Proposal review</h2><p>Compare proposals for this job, then use the existing review and offer actions on each application.</p></div><span>{jobProposals.length} applicant{jobProposals.length === 1 ? "" : "s"}</span></div>
    {proposalLoadFailed ? <div className="marketplace-proposal-error"><p role="status">Proposal details could not be loaded. They remain hidden until the request succeeds.</p><button className="button-secondary" type="button" onClick={onRetry}>Retry proposals</button></div> : jobProposals.length ? <>
      <div className="marketplace-review-toolbar">
        <label>Filter by status<select aria-label="Filter proposals by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="shortlisted">Shortlisted</option><option value="interview_invited">Interview requested</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option><option value="accepted">Accepted</option></select></label>
        <label>Sort proposals<select aria-label="Sort proposals" value={sort} onChange={(event) => setSort(event.target.value as ProposalSort)}><option value="recent">Newest first</option><option value="quote_low">Quote: low to high by currency</option><option value="quote_high">Quote: high to low by currency</option><option value="timeline">Shortest timeline</option></select></label>
        <p className="marketplace-selection-count" aria-live="polite" aria-atomic="true">{selectedProposals.length} of {maxComparedProposals} selected for comparison. Selections stay active while you sort or filter.</p>
        {maxReached && <p id="proposal-comparison-limit" className="marketplace-comparison-limit">Limit reached. Remove a selected proposal before adding another.</p>}
        {selectedProposals.length > 1 && <a className="marketplace-comparison-jump" href="#proposal-comparison-heading" aria-controls="proposal-comparison-panel">Jump to comparison</a>}
        {selectedProposals.length > 0 && <button className="marketplace-text-action" type="button" onClick={() => setSelectedIds([])}>Clear comparison selection</button>}
      </div>
      {visibleProposals.length ? <div className="marketplace-applicant-list" role="list" aria-label="Proposals for this job">{visibleProposals.map((proposal) => {
        const proposalNumber = jobProposals.findIndex((item) => item.id === proposal.id) + 1;
        const status = proposalStatus(proposal);
        const selected = activeSelectedIds.includes(proposal.id);
        const offerable = ["submitted", "shortlisted", "interview_invited"].includes(status);
        return <article className="marketplace-applicant-card" role="listitem" key={proposal.id}>
          <div className="marketplace-proposal-select-row"><label><input type="checkbox" aria-label={(selected ? "Remove proposal " : "Select proposal ") + proposalNumber + " for comparison"} checked={selected} disabled={!selected && maxReached} aria-describedby={maxReached && !selected ? "proposal-comparison-limit" : undefined} onChange={(event) => selectProposal(proposal, event.target.checked)} /> {selected ? "Remove from comparison" : "Add to comparison"}</label></div>
          <div className="marketplace-applicant-top"><span className="marketplace-avatar-small" aria-hidden="true">F</span><div><strong>Applicant proposal {proposalNumber}</strong><small>{proposalAmount(proposal)} · {proposalTimeline(proposal)}</small></div><StatusPill status={status} /></div>
          <p>{proposalCoverLetter(proposal)}</p>
          <span className="marketplace-inline-note">{proposalPortfolioSummary(proposal)}</span>
          {offerable && <div className="marketplace-form-actions"><button className="button-secondary" type="button" onClick={() => onTransition(proposal.id, "shortlist")}>Shortlist</button><button className="button-secondary" type="button" onClick={() => onTransition(proposal.id, "invite_interview")}>Mark interview requested</button><button className="marketplace-text-action" type="button" onClick={() => onTransition(proposal.id, "reject")}>Reject</button></div>}
          {offerable && <OfferComposer value={initialOffer(proposal)} onChange={(field, value) => patchOffer(proposal, field, value)} onSubmit={() => void onOffer(proposal, initialOffer(proposal)).catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "Offer could not be sent."))} />}
          {message && <p role="status" className="marketplace-inline-note">{message}</p>}
        </article>;
      })}</div> : <p className="marketplace-empty-inline" role="status">No proposals match this status filter.</p>}
    </> : <p className="marketplace-empty-inline" role="status">No proposals yet. Applicants' submissions will appear here.</p>}
    {selectedProposals.length === 1 && <p className="marketplace-inline-note">Select one more proposal to open the side-by-side comparison.</p>}
    {selectedProposals.length > 1 && <section id="proposal-comparison-panel" className="marketplace-comparison-panel" aria-labelledby="proposal-comparison-heading">
      <div className="marketplace-section-heading"><div><span className="eyebrow">READ-ONLY VIEW</span><h3 id="proposal-comparison-heading" tabIndex={-1}>Side-by-side comparison</h3><p>Review submitted terms alongside each other. Hiring decisions remain in the proposal actions above.</p></div></div>
      <div className="marketplace-comparison-grid" role="list" aria-label="Selected proposals for comparison">{selectedProposals.map((proposal, index) => {
        const status = proposalStatus(proposal);
        return <article className="marketplace-comparison-card" role="listitem" key={proposal.id}>
          <header><h4>Comparison proposal {index + 1}</h4><StatusPill status={status} /><button className="marketplace-text-action" type="button" aria-label={`Remove selected proposal ${index + 1}`} onClick={() => removeFromComparison(proposal.id)}>Remove</button></header>
          <dl>
            <div><dt>Quoted amount</dt><dd>{proposalAmount(proposal)}</dd></div>
            <div><dt>Delivery timeline</dt><dd>{proposalTimeline(proposal)}</dd></div>
            <div><dt>Proposal status</dt><dd>{proposalStatusLabel(proposal)}</dd></div>
            <div><dt>Cover letter</dt><dd className="marketplace-comparison-letter">{proposalCoverLetter(proposal)}</dd></div>
            <div><dt>Portfolio references</dt><dd>{proposalPortfolioSummary(proposal)}</dd></div>
          </dl>
        </article>;
      })}</div>
      <div className="marketplace-comparison-print-actions">
        <p id="proposal-comparison-print-help">Print the selected proposals only. Use your browser dialog to print or save as PDF.</p>
        <button className="button-secondary" type="button" aria-describedby="proposal-comparison-print-help" onClick={() => window.print()}><Printer size={14} /> Print comparison</button>
      </div>
      <ProposalComparisonPrintDocument jobTitle={jobTitle} proposals={printableProposals} />
    </section>}
  </section>;
}

function OfferComposer({ value, onChange, onSubmit }: { value: { terms: string; amount: string; timeline: string; key: string }; onChange: (field: "terms" | "amount" | "timeline", value: string) => void; onSubmit: () => void }) {
  return <div className="marketplace-offer-composer"><strong>Send an offer</strong><label>Offer terms<textarea required minLength={20} maxLength={5000} rows={3} value={value.terms} onChange={(event) => onChange("terms", event.target.value)} placeholder="Clarify the deliverables, responsibilities, and review steps." /></label><div className="marketplace-form-grid"><label>Offer amount<input required inputMode="decimal" value={value.amount} onChange={(event) => onChange("amount", event.target.value)} /></label><label>Timeline in days<input required type="number" min="1" max="3650" value={value.timeline} onChange={(event) => onChange("timeline", event.target.value)} /></label></div><button type="button" className="button-primary" onClick={onSubmit}>Send offer <Send size={13} /></button></div>;
}

function OfferRow({ offer, onRespond }: { offer: Offer; onRespond: (offer: Offer, decision: "accept" | "decline") => void }) {
  const isRecipient = offer.isRecipient;
  return <article className="marketplace-offer-row"><div><strong>{isRecipient ? "Offer received" : "Offer sent"}</strong><span>{displayMinor(offer.amountMinor, offer.currency)} · {offer.timelineDays} days · {offer.status}</span><p>{offer.terms}</p>{offer.projectId && <Link to={`/app/projects/${offer.projectId}`}>Open draft workspace <ArrowUpRight size={13} /></Link>}</div>{isRecipient && offer.status === "sent" && <div className="marketplace-form-actions"><button type="button" className="button-secondary" onClick={() => onRespond(offer, "decline")}>Decline</button><button type="button" className="button-primary" onClick={() => onRespond(offer, "accept")}>Accept offer <Check size={13} /></button></div>}</article>;
}
