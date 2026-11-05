import { ArrowLeft, ArrowRight, Check, ChevronRight, Clock3, FileCheck2, FileText, MessageSquareText, Plus, Sparkles, Trash2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { DemoNotice, PageHeading, SectionHeading, StatusPill } from "../components/WorkspacePrimitives";
import { demoProject, formatMoney, sumMilestonesCents } from "../data/demo";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, ApiError } from "../lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { draftMilestonePlanSchema } from "@proofpay/shared";

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  if (user && projectId) return <PersistedProjectDetail key={projectId} projectId={projectId} userId={user.id} />;
  if (projectId !== "studio-website") return <section className="empty-filter"><strong>Project not found</strong><p>Sign in with a project member account to view private project records.</p><Link to="/app/projects" className="button-secondary">Back to projects</Link></section>;
  return <DemoProjectDetail />;
}

function DemoProjectDetail() {
  return <>
    <div className="back-link-row"><Link to="/app/projects"><ArrowLeft size={14} /> All projects</Link><span><ChevronRight size={13} /> {demoProject.name}</span></div>
    <PageHeading eyebrow="SAMPLE PROJECT · VERSION 1" title={demoProject.name} description={`${demoProject.client} · Website design & development · Target date ${demoProject.deadlineLabel}`} action={<StatusPill status="In progress" />} />
    <DemoNotice>This is an illustrative project record. Agreement actions, deliverable uploads, and payment records are not connected to Supabase or PayPal in this phase.</DemoNotice>
    <div className="project-detail-grid">
      <div className="detail-main-column">
        <section className="surface-card agreement-card">
          <SectionHeading title="Accepted agreement" subtitle="The shared starting point for the work." link={<span className="version-chip"><FileCheck2 size={13} /> VERSION 1 · SAMPLE</span>} />
          <p className="agreement-summary">{demoProject.description}</p>
          <div className="agreement-data-grid"><DataItem label="PROJECT TOTAL" value={formatMoney(demoProject.budgetCents)} /><DataItem label="CURRENCY" value="USD · US Dollar" /><DataItem label="TARGET COMPLETION" value={demoProject.deadlineLabel} /><DataItem label="ACCEPTANCE" value="Accepted by both parties" /></div>
          <div className="agreement-scope"><span>INCLUDED SCOPE</span><ul><li>Responsive Home, Services, About, and Contact pages</li><li>Contact form routed to the client’s email</li><li>Cross-browser QA and launch handover</li></ul><p>Scheduling, calendar integrations, and appointment booking are excluded unless added by a written change order.</p></div>
          <div className="agreement-accepted"><span><Check size={14} /></span><div><strong>Accepted by both parties</strong><small>Sample version · This preview does not record legal acceptance.</small></div><span className="agreement-time">OCT 22, 2026</span></div>
        </section>
        <section className="surface-card detail-milestones-card">
          <SectionHeading title="Milestones" subtitle="Milestone values reconcile to the agreed project total." link={<span className="sum-check"><Check size={13} /> TOTAL MATCHES</span>} />
          <div className="detail-milestones">{demoProject.milestones.map((milestone, index) => <article className="detail-milestone" key={milestone.id}><span className={`detail-milestone-index${milestone.status === "Approved" ? " is-complete" : ""}`}>{milestone.status === "Approved" ? <Check size={14} /> : `0${index + 1}`}</span><div className="detail-milestone-copy"><div className="detail-milestone-title"><h3>{milestone.title}</h3><StatusPill status={milestone.status} /></div><p>{milestone.description}</p><div className="milestone-foot"><span><Clock3 size={13} /> Due {milestone.dueLabel}, 2026</span><span>{index === 0 ? "Deliverable accepted" : index === 1 ? "Design review pending" : "Starts after design approval"}</span></div></div><strong className="detail-milestone-amount">{formatMoney(milestone.amountCents)}</strong></article>)}</div>
          <div className="milestone-total"><span>Agreed project total</span><strong>{formatMoney(sumMilestonesCents(demoProject.milestones))}</strong></div>
        </section>
      </div>
      <aside className="detail-side-column">
        <section className="surface-card next-step-card"><span className="next-step-icon"><Sparkles size={16} /></span><span className="eyebrow">NEXT STEP</span><h2>Review the new request.</h2><p>Check appointment booking against the agreed scope before anyone commits to extra work.</p><Link to="/app/scope" className="button-primary full-width-button">Open scope review <ArrowRight size={15} /></Link><small>Sample scenario · No agreement change is made here.</small></section>
        <section className="surface-card project-summary-card"><SectionHeading title="Project details" /><SummaryRow label="Client" value="Northstar Studio" /><SummaryRow label="Project owner" value="Olivia Carter" /><SummaryRow label="Project type" value="Web design & development" /><SummaryRow label="Deadline" value={demoProject.deadlineLabel} /><SummaryRow label="PayPal invoice" value="Not connected" status /></section>
        <section className="agreement-version-card"><FileText size={15} /><span><strong>Agreement version history</strong><small>Only accepted versions become the source of truth.</small></span><span className="version-count">1</span></section>
      </aside>
    </div>
  </>;
}

interface PersistedProjectResponse {
  project: {
    id: string; created_by: string; title: string; description: string; client_name: string;
    budget_minor: number | string; currency: string; contract_type: "fixed" | "hourly"; deadline: string | null; status: string;
    current_agreement_version_id: string | null;
  };
  milestones: Array<{
    id: string; sequence: number; title: string; description: string; deliverables: string[];
    acceptance_criteria: string[]; completion_conditions: string[]; amount_minor: number | string; currency: string; due_date: string | null;
    dependency_sequences: number[]; workflow_status: string;
  }>;
  agreements: Array<{
    id: string; version_number: number; state: string; title: string; scope_text: string;
    terms: Record<string, unknown>; total_minor: number | string; currency: string; created_at: string;
  }>;
  scopeRequests: Array<{
    id: string; based_on_agreement_version_id: string; request_text: string; status: string; created_at: string;
  }>;
  aiAnalyses: Array<{
    id: string; change_request_id: string | null; agreement_version_id: string | null; created_at: string;
    result: {
      classification: string; summary: string; concerns: string[]; affectedMilestoneSequences: number[];
      citations: Array<{ source: string; milestoneSequence: number | null; changeOrderVersionId: string | null; exactExcerpt: string }>;
      proposedAmendment: { title: string; description: string; deliverables: string[]; openQuestions: string[]; estimateExplanation: string };
      uncertainty: string;
    };
  }>;
  changeOrders: Array<{
    id: string; change_request_id: string; version_number: number; title: string; description: string;
    amount_delta_minor: number | string; currency: string; schedule_delta_days: number; state: string;
    terms: { deliverables?: string[]; openQuestions?: string[]; analysisId?: string }; created_at: string;
  }>;
  deliverables: Array<{
    id: string; milestone_id: string; description: string; evidence_url: string | null;
    has_private_file: boolean; created_at: string;
  }>;
  milestoneReviews: Array<{
    id: string; milestone_id: string; deliverable_id: string | null; decision: "approved" | "request_revision";
    note: string; created_at: string;
  }>;
}

type EditableMilestone = {
  sequence: number; title: string; description: string; deliverables: string[]; acceptanceCriteria: string[];
  completionConditions: string[]; amountText: string; dueDate: string | null; dependencyText: string;
};

function PersistedProjectDetail({ projectId, userId }: { projectId: string; userId: string }) {
  const [record, setRecord] = useState<PersistedProjectResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [draftPlan, setDraftPlan] = useState<EditableMilestone[] | null>(null);
  const [draftPlanSource, setDraftPlanSource] = useState<"manual" | "ai" | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const idempotencyKeyFor = (operation: string) => {
    const existing = idempotencyKeys.current.get(operation);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    idempotencyKeys.current.set(operation, generated);
    return generated;
  };
  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest<PersistedProjectResponse>(`/api/projects/${projectId}`);
      setRecord(response);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load this project.");
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (key: string, path: string, body?: unknown, idempotencyOperation?: string): Promise<boolean> => {
    setBusy(key);
    setMessage("");
    try {
      await apiRequest(path, { method: "POST", ...(body === undefined ? {} : { body }) });
      if (idempotencyOperation) idempotencyKeys.current.delete(idempotencyOperation);
      setMessage("Your action was recorded.");
      await refresh();
      return true;
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "The action could not be completed.");
      return false;
    } finally {
      setBusy("");
    }
  };

  const analyzeScopeRequest = async (requestId: string) => {
    setBusy(`scope-analysis-${requestId}`);
    setMessage("");
    try {
      await apiRequest(`/api/projects/${projectId}/scope-requests/${requestId}/analyze`, { method: "POST" });
      await refresh();
      setMessage("Evidence-checked scope analysis saved for human review. Any amendment still requires both parties’ approval.");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Scope analysis could not be completed.");
    } finally {
      setBusy("");
    }
  };

  const editDraftMilestones = () => {
    if (!record) return;
    const next = record.milestones.map((milestone) => ({
      sequence: milestone.sequence, title: milestone.title, description: milestone.description,
      deliverables: milestone.deliverables, acceptanceCriteria: milestone.acceptance_criteria,
      completionConditions: milestone.completion_conditions,
      amountText: formatMinorInput(milestone.amount_minor, record.project.currency),
      dueDate: milestone.due_date, dependencyText: milestone.dependency_sequences.join(", "),
    }));
    if (next.some((item) => !item.amountText)) {
      setMessage("This project's minor-unit values exceed the browser's safe integer range; milestone editing is unavailable.");
      return;
    }
    setDraftPlan(next); setDraftPlanSource("manual"); setMessage("");
  };

  const suggestDraftMilestones = async () => {
    if (!record) return;
    const budget = BigInt(record.project.budget_minor);
    if (budget > BigInt(Number.MAX_SAFE_INTEGER)) {
      setMessage("AI milestone allocation requires a project budget within the browser's safe integer range.");
      return;
    }
    setBusy("ai-draft-milestones"); setMessage("");
    try {
      const agreement = record.agreements.find((item) => item.id === record.project.current_agreement_version_id);
      const terms = agreement?.terms ?? {};
      const requirementList = Array.isArray(terms.requirements) ? terms.requirements.filter((item): item is string => typeof item === "string") : [];
      const offerTerms = typeof terms.offerTerms === "string" ? [terms.offerTerms] : [];
      const requirements = [...requirementList, ...offerTerms].slice(0, 50);
      if (requirements.length === 0) requirements.push((agreement?.scope_text ?? record.project.description).slice(0, 1_000));
      const result = await apiRequest<{ rationale: string; milestones: Array<{
        sequence: number; title: string; description: string; deliverables: string[]; acceptanceCriteria: string[];
        completionConditions: string[]; amountMinor: number; dueDate: string | null; dependencySequences: number[];
      }> }>("/api/ai/milestones", { method: "POST", body: {
        projectTitle: record.project.title, projectDescription: agreement?.scope_text ?? record.project.description,
        requirements,
        budgetMinor: Number(budget), currency: record.project.currency,
      } });
      setDraftPlan(result.milestones.map((milestone) => ({
        sequence: milestone.sequence, title: milestone.title, description: milestone.description,
        deliverables: milestone.deliverables, acceptanceCriteria: milestone.acceptanceCriteria,
        completionConditions: milestone.completionConditions,
        amountText: formatMinorInput(milestone.amountMinor, record.project.currency),
        dueDate: milestone.dueDate, dependencyText: milestone.dependencySequences.join(", "),
      })));
      setDraftPlanSource("ai");
      setMessage(`AI suggestions are ready for review. ${result.rationale} No milestone or agreement has been changed yet.`);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "AI could not draft milestone suggestions. The existing draft was not changed.");
    } finally { setBusy(""); }
  };

  const updateDraftMilestone = (index: number, update: Partial<EditableMilestone>) => {
    setDraftPlan((current) => current?.map((milestone, itemIndex) => itemIndex === index ? { ...milestone, ...update } : milestone) ?? null);
  };

  const addDraftMilestone = () => {
    setDraftPlan((current) => {
      if (!current || current.length >= 20) return current;
      return [...current, {
        sequence: current.length + 1, title: `Milestone ${current.length + 1}`, description: "",
        deliverables: [""], acceptanceCriteria: [""], completionConditions: [""],
        amountText: "", dueDate: null, dependencyText: "",
      }];
    });
  };

  const removeDraftMilestone = (removeIndex: number) => {
    setDraftPlan((current) => {
      if (!current || current.length <= 1) return current;
      const removedSequence = current[removeIndex]?.sequence;
      return current.filter((_, index) => index !== removeIndex).map((milestone, index) => {
        const dependencies = milestone.dependencyText.split(",").map((value) => value.trim()).filter(Boolean).map(Number);
        const remapped = dependencies.filter((sequence) => sequence !== removedSequence).map((sequence) => sequence > (removedSequence ?? 0) ? sequence - 1 : sequence);
        return { ...milestone, sequence: index + 1, dependencyText: remapped.join(", ") };
      });
    });
  };

  const saveDraftMilestones = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftPlan || !record) return;
    const currentRecord = record;
    const normalized = draftPlan.map((item) => {
      const amountMinor = parseMinorInput(item.amountText, currentRecord.project.currency);
      const dependencyValues = item.dependencyText.trim() ? item.dependencyText.split(",").map((value) => value.trim()) : [];
      const dependenciesValid = dependencyValues.every((value) => /^[1-9][0-9]{0,1}$/.test(value));
      return {
        sequence: item.sequence, title: item.title, description: item.description,
        deliverables: item.deliverables, acceptanceCriteria: item.acceptanceCriteria,
        completionConditions: item.completionConditions, amountMinor: amountMinor ?? 0,
        dueDate: item.dueDate || null,
        dependencySequences: dependenciesValid ? dependencyValues.map(Number) : [],
        dependenciesValid,
      };
    });
    if (normalized.some((item) => item.amountMinor < 1 || !item.dependenciesValid)) {
      setMessage("Enter a positive exact amount for every milestone and list dependencies as earlier sequence numbers separated by commas.");
      return;
    }
    const total = normalized.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
    if (total !== BigInt(currentRecord.project.budget_minor)) {
      setMessage("Adjust the milestone amounts so they are positive and add up to the project budget exactly.");
      return;
    }
    const plan = normalized.map((item) => ({
      sequence: item.sequence, title: item.title, description: item.description,
      deliverables: item.deliverables, acceptanceCriteria: item.acceptanceCriteria,
      completionConditions: item.completionConditions, amountMinor: item.amountMinor,
      dueDate: item.dueDate, dependencySequences: item.dependencySequences,
    }));
    const parsed = draftMilestonePlanSchema.safeParse({ milestones: plan });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Review milestone descriptions, criteria, sequence, dates, and dependencies.");
      return;
    }
    const saved = await act("save-draft-milestones", `/api/projects/${projectId}/draft-milestones`, parsed.data);
    if (saved) { setDraftPlan(null); setDraftPlanSource(null); setMessage("Milestones saved to the draft agreement. Neither party has approved or shared it yet."); }
  };

  const submitScopeRequest = async (text: string): Promise<boolean> => {
    const operation = "scope-request";
    setBusy("scope");
    setMessage("");
    let requestId: string | undefined;
    try {
      const saved = await apiRequest<{ requestId: string }>(`/api/projects/${projectId}/scope-requests`, {
        method: "POST",
        body: { requestText: text, idempotencyKey: idempotencyKeyFor(operation) },
      });
      requestId = saved.requestId;
      idempotencyKeys.current.delete(operation);
      await apiRequest(`/api/projects/${projectId}/scope-requests/${requestId}/analyze`, { method: "POST" });
      await refresh();
      setMessage("Scope request and evidence-checked analysis saved. Any amendment still requires both parties’ approval.");
      return true;
    } catch (cause) {
      if (requestId) await refresh();
      const detail = cause instanceof ApiError ? cause.message : "AI analysis could not be completed.";
      setMessage(requestId ? `Scope request saved; analysis is still pending. ${detail}` : detail);
      return Boolean(requestId);
    } finally {
      setBusy("");
    }
  };

  const submitChangeOrder = (requestId: string, draft: {
    idempotencyKey: string; title: string; description: string; amountDeltaMinor: number;
    scheduleDeltaDays: number; deliverables: string[]; openQuestions: string[]; analysisId: string;
  }) => act(
    `change-order-${requestId}`,
    `/api/projects/${projectId}/scope-requests/${requestId}/change-orders`,
    draft,
    `change-order:${requestId}`,
  );

  const decideChangeOrder = (changeOrderId: string, decision: "accept" | "reject") => act(
    `change-order-decision-${changeOrderId}`,
    `/api/change-orders/${changeOrderId}/decision`,
    { decision },
  );

  if (error && !record) return <section className="empty-filter" role="alert"><strong>Project unavailable</strong><p>{error}</p><button type="button" className="button-secondary" onClick={() => void refresh()}>Try again</button></section>;
  if (!record) return <section className="empty-filter" aria-live="polite"><strong>Loading project…</strong></section>;

  const { project, milestones, agreements } = record;
  const currentAgreement = agreements.find((agreement) => agreement.id === project.current_agreement_version_id) ?? agreements[0];
  const creator = project.created_by === userId;
  const total = milestones.reduce((sum, item) => sum + BigInt(item.amount_minor), 0n);
  const draftCanEdit = creator && project.status === "draft" && currentAgreement?.state === "draft";
  const requiresMilestoneReview = project.contract_type !== "hourly" && typeof currentAgreement?.terms.marketplaceOfferId === "string"
    && currentAgreement.terms.milestonePlanReviewed !== true;
  const hourlyAgreementReady = project.contract_type === "hourly"
    && currentAgreement?.terms.contractType === "hourly"
    && currentAgreement.terms.hourlyRateMinor === String(project.budget_minor)
    && currentAgreement.terms.hourlyRateCurrency === project.currency
    && currentAgreement.currency === project.currency
    && milestones.length === 0;
  const acceptanceReady = project.contract_type === "hourly" ? hourlyAgreementReady : !requiresMilestoneReview && milestones.length > 0 && total === BigInt(project.budget_minor)
    && milestones.every((milestone) => milestone.workflow_status === "draft"
      && milestone.deliverables.length > 0 && milestone.acceptance_criteria.length > 0 && milestone.completion_conditions.length > 0);
  return <>
    <div className="back-link-row"><Link to="/app/projects"><ArrowLeft size={14} /> All projects</Link><span><ChevronRight size={13} /> {project.title}</span></div>
    <PageHeading eyebrow="PERSISTED PROJECT" title={project.title} description={`${project.client_name} · ${project.deadline ? `Due ${project.deadline}` : "No deadline set"}`} action={<span className="status-pill status-progress">{titleCase(project.status)}</span>} />
    <DemoNotice>This project is loaded from Supabase using your signed-in session and project RLS. AI analysis, file uploads, and PayPal payments remain separate integrations.</DemoNotice>
    {message && <p role="status" className="auth-message">{message}</p>}
    {error && <p role="alert" className="auth-message">{error}</p>}
    <div className="project-detail-grid">
      <div className="detail-main-column">
        <section className="surface-card agreement-card">
          <SectionHeading title={currentAgreement ? `Agreement · version ${currentAgreement.version_number}` : "Agreement draft"} subtitle={currentAgreement?.state === "accepted" ? "This accepted version is immutable." : "This project draft has not been accepted by both parties."} link={<span className="version-chip"><FileCheck2 size={13} />{titleCase(currentAgreement?.state ?? "draft")}</span>} />
          <p className="agreement-summary">{currentAgreement?.scope_text ?? project.description}</p>
          <div className="agreement-data-grid"><DataItem label={project.contract_type === "hourly" ? "HOURLY RATE" : "PROJECT TOTAL"} value={project.contract_type === "hourly" ? `${formatMinor(project.budget_minor, project.currency)} / hour` : formatMinor(project.budget_minor, project.currency)} /><DataItem label="CURRENCY" value={project.currency} /><DataItem label="CONTRACT TYPE" value={project.contract_type === "hourly" ? "Hourly" : "Fixed price"} /><DataItem label="AGREEMENT STATE" value={titleCase(currentAgreement?.state ?? "draft")} /></div>
          {currentAgreement && currentAgreement.state !== "accepted" && acceptanceReady
            && <button type="button" className="button-primary" disabled={Boolean(busy)} onClick={() => void act("accept", `/api/agreements/${currentAgreement.id}/accept`)}>Record my agreement acceptance <Check size={14} /></button>}
          {currentAgreement && currentAgreement.state !== "accepted" && !acceptanceReady
            && <p className="draft-milestone-lock-note">{project.contract_type === "hourly" ? "Review the agreed hourly rate and written terms before either party accepts." : draftCanEdit ? "Complete and save a milestone plan that matches the agreement amount before either party accepts." : "The milestone plan is still being prepared. Agreement acceptance is unavailable until its amounts and criteria are complete."}</p>}
        </section>
        {project.contract_type === "hourly" ? <section className="surface-card detail-milestones-card"><SectionHeading title="Hourly work" subtitle="The agreement sets a rate. Each submitted time entry is reviewed before it can be invoiced." /><p className="agreement-summary">No fixed milestone allocation is used for this contract. The freelancer controls manual entries and the optional project timer; the client approves or disputes each submitted entry.</p><Link to={`/app/projects/${project.id}/hourly`} className="button-primary"><Clock3 size={14} /> Open hourly workspace <ArrowRight size={14} /></Link></section> : <section className="surface-card detail-milestones-card">
          <SectionHeading title="Milestones" subtitle="Values are checked against the project draft budget." link={<span className="sum-check"><Check size={13} />{total === BigInt(project.budget_minor) ? "TOTAL MATCHES" : "TOTAL NEEDS REVIEW"}</span>} />
          {draftCanEdit && <div className="draft-milestone-tools">
            <div><strong>Prepare the agreement milestone plan</strong><p>Review the terms and amounts before either party records acceptance. AI suggestions stay editable and unsaved until you save them.</p></div>
            {!draftPlan && <div className="draft-milestone-actions">
              <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={editDraftMilestones}>Edit milestone plan</button>
              <button type="button" className="button-primary" disabled={Boolean(busy)} onClick={() => void suggestDraftMilestones()}><Sparkles size={14} /> Suggest with AI</button>
            </div>}
          </div>}
          <div className="detail-milestones">{milestones.map((milestone) => <article className="detail-milestone" key={milestone.id}>
            <span className="detail-milestone-index">{String(milestone.sequence).padStart(2, "0")}</span><div className="detail-milestone-copy"><div className="detail-milestone-title"><h3>{milestone.title}</h3><span className="status-pill status-progress">{titleCase(milestone.workflow_status)}</span></div><p>{milestone.description}</p>
              <div className="milestone-foot"><span><Clock3 size={13} /> {milestone.due_date ? `Due ${milestone.due_date}` : "No milestone deadline"}</span><span>{milestone.deliverables.join(" · ")}</span></div>
              {creator && milestone.workflow_status === "agreed" && <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => void act(`start-${milestone.id}`, `/api/milestones/${milestone.id}/start`)}>Start milestone</button>}
              {creator && ["agreed", "in_progress", "revision_requested"].includes(milestone.workflow_status) && <form className="project-action-form" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const operation = `deliver:${milestone.id}`; const idempotencyKey = idempotencyKeyFor(operation); void act(`deliver-${milestone.id}`, `/api/milestones/${milestone.id}/deliverables`, { description: String(values.get("description") ?? ""), evidenceUrl: String(values.get("evidenceUrl") ?? ""), idempotencyKey }, operation); }}><label>Submit deliverable evidence<input name="evidenceUrl" type="url" placeholder="https://…" required /></label><label>Work summary<input name="description" minLength={1} maxLength={2000} required /></label><button className="button-secondary" type="submit" disabled={Boolean(busy)}>Submit for client review</button></form>}
              {!creator && milestone.workflow_status === "submitted_for_review" && <div className="project-action-form"><button type="button" className="button-primary" disabled={Boolean(busy)} onClick={() => { const operation = `approve:${milestone.id}`; void act(`approve-${milestone.id}`, `/api/milestones/${milestone.id}/reviews`, { decision: "approved", note: "", idempotencyKey: idempotencyKeyFor(operation) }, operation); }}>Approve deliverable</button><form onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const operation = `revise:${milestone.id}`; void act(`revise-${milestone.id}`, `/api/milestones/${milestone.id}/reviews`, { decision: "request_revision", note: String(values.get("note") ?? ""), idempotencyKey: idempotencyKeyFor(operation) }, operation); }}><label>Revision note<input name="note" minLength={3} maxLength={4000} required /></label><button type="submit" className="button-secondary" disabled={Boolean(busy)}>Request revision</button></form></div>}
              <MilestoneHistory
                sequence={milestone.sequence}
                workflowStatus={milestone.workflow_status}
                submissions={record.deliverables.filter((item) => item.milestone_id === milestone.id)}
                reviews={record.milestoneReviews.filter((item) => item.milestone_id === milestone.id)}
              />
            </div><strong className="detail-milestone-amount">{formatMinor(milestone.amount_minor, milestone.currency)}</strong></article>)}</div>
          {draftCanEdit && draftPlan && <form className="draft-milestone-editor" onSubmit={(event) => void saveDraftMilestones(event)}>
            <div className="draft-milestone-editor-heading"><div><strong>{draftPlanSource === "ai" ? "AI suggestion · review and edit" : "Edit milestone plan"}</strong><p>Exact amounts must add up to {formatMinor(project.budget_minor, project.currency)}. Saving updates this draft only.</p></div><button type="button" className="button-secondary" onClick={() => { setDraftPlan(null); setDraftPlanSource(null); }} disabled={Boolean(busy)}>Cancel</button></div>
            {draftPlan.map((milestone, index) => <fieldset className="draft-milestone-card" key={`draft-${milestone.sequence}`}>
              <legend>Milestone {String(milestone.sequence).padStart(2, "0")}</legend>
              <button type="button" className="draft-milestone-remove" aria-label={`Remove milestone ${milestone.sequence}`} disabled={draftPlan.length <= 1 || Boolean(busy)} onClick={() => removeDraftMilestone(index)}><Trash2 size={15} /></button>
              <label>Title<input value={milestone.title} maxLength={120} required onChange={(event) => updateDraftMilestone(index, { title: event.currentTarget.value })} /></label>
              <label>Description<textarea value={milestone.description} minLength={2} maxLength={2000} required onChange={(event) => updateDraftMilestone(index, { description: event.currentTarget.value })} /></label>
              <div className="draft-milestone-grid">
                <label>Amount ({project.currency})<input value={milestone.amountText} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" required onChange={(event) => updateDraftMilestone(index, { amountText: event.currentTarget.value })} /></label>
                <label>Due date<input type="date" value={milestone.dueDate ?? ""} onChange={(event) => updateDraftMilestone(index, { dueDate: event.currentTarget.value || null })} /></label>
              </div>
              <label>Deliverables <small>One item per line</small><textarea value={milestone.deliverables.join("\n")} required onChange={(event) => updateDraftMilestone(index, { deliverables: linesFromText(event.currentTarget.value) })} /></label>
              <label>Acceptance criteria <small>One item per line</small><textarea value={milestone.acceptanceCriteria.join("\n")} required onChange={(event) => updateDraftMilestone(index, { acceptanceCriteria: linesFromText(event.currentTarget.value) })} /></label>
              <label>Completion conditions <small>One item per line</small><textarea value={milestone.completionConditions.join("\n")} required onChange={(event) => updateDraftMilestone(index, { completionConditions: linesFromText(event.currentTarget.value) })} /></label>
              <label>Depends on earlier milestones<input value={milestone.dependencyText} placeholder="Example: 1, 2" onChange={(event) => updateDraftMilestone(index, { dependencyText: event.currentTarget.value })} /></label>
            </fieldset>)}
            <div className="draft-milestone-editor-footer"><button type="button" className="button-secondary" disabled={draftPlan.length >= 20 || Boolean(busy)} onClick={addDraftMilestone}><Plus size={14} /> Add milestone</button><button type="submit" className="button-primary" disabled={Boolean(busy)}>{busy === "save-draft-milestones" ? "Saving draft…" : "Save draft milestones"}</button></div>
          </form>}
          <div className="milestone-total"><span>Project budget</span><strong>{formatMinor(project.budget_minor, project.currency)}</strong></div>
        </section>}
        <ScopeRequest
          onSubmit={submitScopeRequest}
          onAnalyze={analyzeScopeRequest}
          onPropose={submitChangeOrder}
          onDecision={decideChangeOrder}
          busy={Boolean(busy)}
          canRequest={!creator}
          canPropose={creator}
          requests={record.scopeRequests}
          analyses={record.aiAnalyses}
          changeOrders={record.changeOrders}
        />
      </div>
      <aside className="detail-side-column"><section className="surface-card project-summary-card"><SectionHeading title="Project details" /><SummaryRow label="Client" value={project.client_name} /><SummaryRow label="Project owner" value={creator ? "You" : "Project freelancer"} /><SummaryRow label="Project status" value={titleCase(project.status)} /><SummaryRow label="Contract type" value={project.contract_type === "hourly" ? "Hourly" : "Fixed price"} /><SummaryRow label="Deadline" value={project.deadline ?? "Not set"} /><SummaryRow label="Payment" value="PayPal Sandbox not configured" status /></section>{project.contract_type === "hourly" && <section className="surface-card project-messaging-card"><SectionHeading title="Hourly work" subtitle="Track time and review submitted entries." /><Link to={`/app/projects/${project.id}/hourly`} className="button-secondary"><Clock3 size={14} /> Open hourly workspace <ArrowRight size={14} /></Link></section>}<section className="surface-card project-messaging-card"><SectionHeading title="Project conversation" subtitle="Keep handoffs and decisions with this project's members." /><Link to={`/app/messages?projectId=${project.id}`} className="button-secondary"><MessageSquareText size={14} /> Open private conversation <ArrowRight size={14} /></Link></section><section className="agreement-version-card"><FileText size={15} /><span><strong>Agreement history</strong><small>{agreements.length} saved version{agreements.length === 1 ? "" : "s"}; accepted terms remain locked.</small></span><span className="version-count">{agreements.length}</span></section></aside>
    </div>
  </>;
}

function MilestoneHistory({
  sequence, workflowStatus, submissions, reviews,
}: {
  sequence: number;
  workflowStatus: string;
  submissions: PersistedProjectResponse["deliverables"];
  reviews: PersistedProjectResponse["milestoneReviews"];
}) {
  return <section className="milestone-history" aria-label={`Milestone ${sequence} submission and review history`}>
    <h4>Submission history</h4>
    {submissions.length > 0 ? <ol className="milestone-history-list">
      {submissions.map((submission, index) => {
        const evidenceUrl = safeEvidenceUrl(submission.evidence_url);
        return <li className="milestone-history-entry" key={submission.id}>
          <div className="milestone-history-heading">
            <strong>Submission {index + 1}</strong>
            <time dateTime={submission.created_at}>{formatHistoryDate(submission.created_at)}</time>
          </div>
          <p className="milestone-history-summary">{submission.description}</p>
          {evidenceUrl
            ? <a className="milestone-evidence-link" href={evidenceUrl.href} target="_blank" rel="noopener noreferrer">{evidenceUrl.href}</a>
            : submission.evidence_url
              ? <p className="milestone-history-muted">Saved evidence link is invalid or unsupported and was not made clickable.</p>
              : null}
          {submission.has_private_file && <p className="milestone-history-muted">A private file is attached. Its storage path and a public file URL are not exposed here.</p>}
        </li>;
      })}
    </ol> : <p className="milestone-history-muted">{workflowStatus === "submitted_for_review" || workflowStatus === "revision_requested" ? "No submission evidence is available in the project record." : "No deliverable submissions yet."}</p>}

    <h4>Review history</h4>
    {reviews.length > 0 ? <ol className="milestone-history-list">
      {reviews.map((review) => <li className="milestone-history-entry" key={review.id}>
        <div className="milestone-history-heading">
          <strong>Client review · {review.decision === "request_revision" ? "Revision requested" : "Approved"}</strong>
          <time dateTime={review.created_at}>{formatHistoryDate(review.created_at)}</time>
        </div>
        {review.note.trim() ? <p className="milestone-review-note">{review.note}</p> : <p className="milestone-history-muted">No written feedback was added.</p>}
      </li>)}
    </ol> : <p className="milestone-history-muted">No client review is recorded yet.</p>}
  </section>;
}

function safeEvidenceUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Recorded time unavailable" : date.toLocaleString();
}

function ScopeRequest({
  onSubmit, onAnalyze, onPropose, onDecision, busy, canRequest, canPropose, requests, analyses, changeOrders,
}: {
  onSubmit: (text: string) => Promise<boolean>;
  onAnalyze: (requestId: string) => Promise<void>;
  onPropose: (requestId: string, draft: {
    idempotencyKey: string; title: string; description: string; amountDeltaMinor: number;
    scheduleDeltaDays: number; deliverables: string[]; openQuestions: string[]; analysisId: string;
  }) => Promise<boolean>;
  onDecision: (changeOrderId: string, decision: "accept" | "reject") => Promise<boolean>;
  busy: boolean;
  canRequest: boolean;
  canPropose: boolean;
  requests: PersistedProjectResponse["scopeRequests"];
  analyses: PersistedProjectResponse["aiAnalyses"];
  changeOrders: PersistedProjectResponse["changeOrders"];
}) {
  const proposalKeys = useRef(new Map<string, string>());
  return <section className="surface-card agreement-card">
    <SectionHeading title="Request a scope change" subtitle="AI compares your request with the accepted agreement and cites exact evidence." />
    {canRequest && <form className="project-action-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void onSubmit(String(values.get("requestText") ?? "").trim()).then((saved) => { if (saved) form.reset(); }); }}>
      <label>Describe the requested change<textarea name="requestText" minLength={1} maxLength={6000} required /></label>
      <button className="button-secondary" type="submit" disabled={busy}><Sparkles size={14} /> Send and review scope</button>
    </form>}
    {requests.length > 0 && <div className="scope-analysis-list">
      {requests.map((scopeRequest) => {
        const analysis = analyses.find((item) => item.change_request_id === scopeRequest.id);
        const amendments = changeOrders.filter((item) => item.change_request_id === scopeRequest.id);
        const awaitingApproval = amendments.find((item) => item.state === "awaiting_approval");
        return <article className="scope-analysis-card" key={scopeRequest.id}>
          <div className="detail-milestone-title"><h3>Scope request · {titleCase(scopeRequest.status)}</h3>{!analysis && <span className="status-pill status-progress">Pending review</span>}</div>
          <p className="request-message">{scopeRequest.request_text}</p>
          {analysis ? <div className="scope-analysis-result">
            <strong>{titleCase(analysis.result.classification)}</strong>
            <p>{analysis.result.summary}</p>
            {analysis.result.citations.map((citation, index) => <blockquote key={`${analysis.id}-${index}`}>“{citation.exactExcerpt}” <small>· {citation.source.replaceAll("_", " ")}{citation.milestoneSequence === null ? "" : ` · milestone ${citation.milestoneSequence}`}{citation.changeOrderVersionId ? ` · version ${citation.changeOrderVersionId.slice(0, 8)}` : ""}</small></blockquote>)}
            <div className="scope-amendment-draft"><span>PROPOSED DRAFT · NOT AN AGREEMENT</span><h4>{analysis.result.proposedAmendment.title}</h4><p>{analysis.result.proposedAmendment.description}</p><small>{analysis.result.proposedAmendment.estimateExplanation}</small></div>
            <p className="demo-form-note"><span /> {analysis.result.uncertainty} Both parties must review and approve any amendment.</p>
            {canPropose && !awaitingApproval && !amendments.some((item) => item.state === "accepted") && <form className="project-action-form" onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const amountDeltaMinor = decimalToSignedMinor(String(values.get("amountDelta") ?? ""));
              const scheduleDeltaDays = Number(values.get("scheduleDeltaDays"));
              const deliverables = String(values.get("deliverables") ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
              if (amountDeltaMinor === null || !Number.isInteger(scheduleDeltaDays) || Math.abs(scheduleDeltaDays) > 365) return;
              const idempotencyKey = proposalKeys.current.get(scopeRequest.id) ?? crypto.randomUUID();
              proposalKeys.current.set(scopeRequest.id, idempotencyKey);
              void onPropose(scopeRequest.id, {
                idempotencyKey,
                title: String(values.get("title") ?? "").trim(),
                description: String(values.get("description") ?? "").trim(),
                amountDeltaMinor,
                scheduleDeltaDays,
                deliverables,
                openQuestions: analysis.result.proposedAmendment.openQuestions,
                analysisId: analysis.id,
              }).then((saved) => { if (saved) proposalKeys.current.delete(scopeRequest.id); });
            }}>
              <p className="demo-form-note"><span /> Add the human-negotiated price and schedule before you submit. AI cannot set these terms.</p>
              <label>Amendment title<input name="title" defaultValue={analysis.result.proposedAmendment.title} required maxLength={160} /></label>
              <label>Amendment description<textarea name="description" defaultValue={analysis.result.proposedAmendment.description} required maxLength={8000} /></label>
              <label>Price change (USD)<input name="amountDelta" type="text" inputMode="decimal" placeholder="25.00 or -25.00" required pattern="-?(0|[1-9][0-9]*)(\\.[0-9]{1,2})?" /></label>
              <label>Schedule change (days)<input name="scheduleDeltaDays" type="number" min={-365} max={365} step={1} defaultValue={0} required /></label>
              <label>Added deliverables<textarea name="deliverables" defaultValue={analysis.result.proposedAmendment.deliverables.join("\n")} placeholder="One deliverable per line" /></label>
              <button type="submit" className="button-primary" disabled={busy}>Submit amendment for client approval</button>
            </form>}
          </div> : <button type="button" className="button-secondary" disabled={busy} onClick={() => void onAnalyze(scopeRequest.id)}><Sparkles size={14} /> Analyze against accepted agreement</button>}
          {amendments.map((amendment) => <div className="accepted-amendment-card" key={amendment.id}>
            <div className="detail-milestone-title"><h4>{amendment.title}</h4><span className="status-pill status-progress">{titleCase(amendment.state)}</span></div>
            <p>{amendment.description}</p>
            <small>Price change {formatSignedMinor(amendment.amount_delta_minor, amendment.currency)} · Schedule change {amendment.schedule_delta_days > 0 ? "+" : ""}{amendment.schedule_delta_days} days</small>
            {(amendment.terms.deliverables ?? []).length > 0 && <small>Deliverables: {amendment.terms.deliverables!.join(" · ")}</small>}
            {amendment.state === "awaiting_approval" && !canPropose && <div className="project-action-form amendment-decision-actions">
              <p>The freelancer has submitted this addendum. It becomes accepted only after your approval.</p>
              <button type="button" className="button-primary" disabled={busy} onClick={() => void onDecision(amendment.id, "accept")}>Accept addendum</button>
              <button type="button" className="button-secondary" disabled={busy} onClick={() => void onDecision(amendment.id, "reject")}>Reject addendum</button>
            </div>}
            {amendment.state === "accepted" && <p className="demo-form-note"><span /> Both parties accepted this addendum. Base milestone totals and invoicing still use the original project schedule in this phase.</p>}
          </div>)}
        </article>;
      })}
    </div>}
  </section>;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatMinor(value: string | number, currency: string): string {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return `${currency} ${value} minor units`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100);
}

function currencyMinorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function formatMinorInput(value: string | number, currency: string): string {
  try {
    const minor = BigInt(value);
    if (minor < 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return "";
    const digits = currencyMinorDigits(currency);
    if (digits === 0) return minor.toString();
    const factor = 10n ** BigInt(digits);
    const whole = minor / factor;
    const fraction = (minor % factor).toString().padStart(digits, "0");
    return `${whole}.${fraction}`;
  } catch {
    return "";
  }
}

function parseMinorInput(value: string, currency: string): number | null {
  const text = value.trim();
  const digits = currencyMinorDigits(currency);
  const match = digits === 0
    ? text.match(/^(0|[1-9][0-9]*)$/)
    : text.match(new RegExp(`^(0|[1-9][0-9]*)(?:\\.([0-9]{0,${digits}}))?$`));
  if (!match) return null;
  const factor = 10n ** BigInt(digits);
  const whole = BigInt(match[1]!);
  const fraction = digits === 0 ? 0n : BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
  const minor = whole * factor + fraction;
  if (minor < 1n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

function linesFromText(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function formatSignedMinor(value: string | number, currency: string): string {
  const amount = BigInt(value);
  const sign = amount > 0n ? "+" : amount < 0n ? "−" : "";
  const absolute = amount < 0n ? -amount : amount;
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(absolute) / 100);
  return `${sign}${formatted}`;
}

function decimalToSignedMinor(value: string): number | null {
  const match = value.trim().match(/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(2, "0");
  let minor = BigInt(match[2]!) * 100n + BigInt(fraction || "0");
  if (match[1] === "-") minor = -minor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(minor);
}

function DataItem({ label, value }: { label: string; value: string }) {
  return <div className="agreement-data-item"><span>{label}</span><strong>{value}</strong></div>;
}

function SummaryRow({ label, value, status = false }: { label: string; value: string; status?: boolean }) {
  return <div className="summary-row"><span>{label}</span>{status ? <StatusPill status="Not connected" /> : <strong>{value}</strong>}</div>;
}
