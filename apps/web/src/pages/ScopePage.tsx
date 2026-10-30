import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, CircleAlert, FileCheck2, MessageSquareText, Send, ShieldCheck, Sparkles } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import { DemoNotice, PageHeading, StatusPill } from "../components/WorkspacePrimitives";
import type { ShellContext } from "../components/AppShell";
import { acceptedScopeExcerpt, formatMoney } from "../data/demo";

export function ScopePage() {
  const { role, notify } = useOutletContext<ShellContext>();
  const [expanded, setExpanded] = useState(true);
  const [request, setRequest] = useState("Could we add a way for customers to pick a time for an intro call?");
  const [requestSent, setRequestSent] = useState(false);
  const [showChangePreview, setShowChangePreview] = useState(false);

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestSent(true);
    notify("Request preview updated locally. It has not been analyzed by an AI provider or saved.");
  };

  return <>
    <PageHeading eyebrow="PROJECT · SCOPE INTELLIGENCE" title="Review the request." description="See what the agreement says before deciding how to move forward." action={<Link to="/app/projects/studio-website" className="button-secondary">View agreement <FileCheck2 size={15} /></Link>} />
    <DemoNotice>Illustrative sample analysis. No AI provider is connected; the explanation and proposed change below are authored sample content, not model output.</DemoNotice>
    <div className="scope-workspace-grid">
      <section className="scope-left-column">
        <article className="surface-card request-detail-card"><div className="request-detail-top"><span className="scope-request-icon"><MessageSquareText size={17} /></span><div><span className="eyebrow">CLIENT SCOPE REQUEST · SAMPLE</span><h2>Appointment booking</h2></div><span className="sample-mini-tag"><span /> PREVIEW</span></div><p className="request-message">“{request}”</p><div className="request-origin"><span className="mini-avatar">NS</span><span><strong>Northstar Studio</strong><small>{requestSent ? "Local preview updated just now" : "Submitted for review · sample"}</small></span></div></article>

        <article className="surface-card cited-scope-card"><button className="collapsible-heading" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span className="cited-heading-icon"><FileCheck2 size={16} /></span><span><strong>Accepted agreement, version 1</strong><small>Scope of work · October 22, 2026 · Sample text</small></span><ChevronDown size={16} className={expanded ? "rotate-chevron" : ""} /></button>{expanded && <div className="cited-excerpt"><span className="excerpt-label">RELEVANT AGREEMENT EXCERPT</span><blockquote>{acceptedScopeExcerpt}</blockquote><div className="excerpt-reference"><span><ShieldCheck size={13} /> Source text in sample agreement</span><span>V1 · SCOPE OF WORK</span></div></div>}</article>

        <article className="surface-card affected-card"><div className="affected-heading"><div><span className="eyebrow">PROJECT IMPACT</span><h2>Milestones to review</h2></div><span className="impact-count">2 affected</span></div><div className="affected-row"><span className="affected-dot" /><span><strong>Visual design & content</strong><small>May need a scheduling flow and new page states.</small></span><span className="impact-label">POSSIBLE</span></div><div className="affected-row"><span className="affected-dot muted" /><span><strong>Build, QA & launch</strong><small>Calendar or booking integration is new implementation work.</small></span><span className="impact-label">LIKELY</span></div><p className="affected-footnote"><CircleAlert size={14} /> Milestone impact is illustrative and should be confirmed by both parties.</p></article>

        <article className="surface-card scope-response-card"><div className="response-card-heading"><span className="response-icon"><MessageSquareText size={16} /></span><div><strong>{role === "client" ? "Add context to the request" : "Ask a clarifying question"}</strong><small>Use this preview to explore the request flow.</small></div></div><form onSubmit={submitRequest}><label htmlFor="scope-context">{role === "client" ? "What should the booking flow include?" : "Your question for the client"}</label><textarea id="scope-context" rows={3} maxLength={600} value={request} onChange={(event) => setRequest(event.target.value)} /><div className="scope-form-footer"><span>{request.length}/600 characters · Not submitted to a server</span><button className="button-secondary" type="submit">Preview update <Send size={14} /></button></div></form></article>
      </section>

      <aside className="scope-right-column">
        <article className="surface-card analysis-card"><div className="analysis-card-head"><span className="analysis-sparkle"><Sparkles size={17} /></span><span><strong>Scope assessment</strong><small>Illustrative sample · no model call</small></span></div><div className="classification-box"><span>CLASSIFICATION</span><strong><CircleAlert size={15} /> Outside current scope</strong></div><p className="analysis-explanation">The accepted sample agreement explicitly excludes scheduling and appointment booking. Adding a customer-facing time selection flow would extend the listed pages and may require calendar integration.</p><div className="confidence-row"><span>Sample rationale</span><span>Human review required</span></div><div className="analysis-divider" /><span className="eyebrow impact-eyebrow">POTENTIAL CHANGE ORDER · SAMPLE</span><h3>Appointment booking flow</h3><div className="proposal-lines"><div><span>Illustrative additional work</span><strong>{formatMoney(18_000)}</strong></div><div><span>Illustrative schedule impact</span><strong>+5 business days</strong></div></div><div className="proposal-warning"><CircleAlert size={15} /><span>This example is not an estimate, an agreement, or a commitment. Confirm details before proposing terms.</span></div><button className="button-primary full-width-button" type="button" onClick={() => setShowChangePreview(!showChangePreview)}>{showChangePreview ? "Hide change-order preview" : "Preview change order"}<ArrowRight size={15} /></button>{showChangePreview && <div className="approval-preview"><div className="approval-preview-title"><span><Check size={14} /></span><div><strong>Draft for discussion</strong><small>No party has approved this sample.</small></div></div><p>Would add appointment booking to the project scope, subject to written terms and both parties’ approval.</p><div className="approval-parties"><span>Freelancer <StatusPill status="Awaiting review" /></span><span>Client <StatusPill status="Awaiting review" /></span></div><button className="button-secondary full-width-button" type="button" onClick={() => notify("No change order was sent. Two-party approval requires the Phase 2 project workflow.")}>Review approval requirements</button></div>}</article>
        <div className="scope-human-note"><ShieldCheck size={17} /><p><strong>People make the call.</strong> A request only changes scope when both parties approve a versioned amendment.</p></div>
      </aside>
    </div>
  </>;
}
