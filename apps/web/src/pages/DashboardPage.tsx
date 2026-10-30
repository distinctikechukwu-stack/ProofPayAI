import { ArrowRight, ArrowUpRight, CalendarDays, Check, FileClock, FileText, MoveUpRight, Sparkles, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { DemoNotice, PageHeading, SectionHeading, StatusPill } from "../components/WorkspacePrimitives";
import type { ShellContext } from "../components/AppShell";
import { demoProject, formatMoney } from "../data/demo";

export function DashboardPage() {
  const { role, notify } = useOutletContext<ShellContext>();
  const isClient = role === "client";

  return <>
    <PageHeading eyebrow={isClient ? "CLIENT WORKSPACE · SAMPLE DATA" : "FREELANCER WORKSPACE · SAMPLE DATA"} title={isClient ? "A clear view of the work." : "Your work, in good shape."} description={isClient ? "See what’s agreed, what’s in progress, and what needs your review." : "A calm overview of your projects, approvals, and next steps."} action={<Link to="/app/projects" className="button-primary"><span>View project</span><ArrowRight size={15} /></Link>} />
    <DemoNotice>Sample workspace for the ProofPay AI demo. These project and agreement details are illustrative; no account data or provider events are connected.</DemoNotice>

    <div className="stats-grid">
      <StatCard label="Agreed project value" value={formatMoney(demoProject.budgetCents)} icon={<WalletCards size={17} />} tone="blue" note="One sample project" />
      <StatCard label="Milestones approved" value="1 / 3" icon={<Check size={17} />} tone="green" note="One ready for next step" />
      <StatCard label={isClient ? "Items for your review" : "Scope requests"} value="01" icon={<Sparkles size={17} />} tone="violet" note="Sample request included" />
      <StatCard label="PayPal Sandbox" value="Not connected" icon={<FileText size={17} />} tone="amber" note="Invoice actions unavailable" small />
    </div>

    <div className="dashboard-main-grid">
      <section className="surface-card project-overview-card">
        <SectionHeading title="Current project" subtitle="A shared view of the agreed work." link={<Link to="/app/projects" className="text-link">All projects <ArrowUpRight size={14} /></Link>} />
        <div className="current-project-heading"><span className="project-icon"><FileText size={19} /></span><div><h3>{demoProject.name}</h3><p>{demoProject.client}<span> · </span>Due {demoProject.deadlineLabel}</p></div><span className="project-total">{formatMoney(demoProject.budgetCents)}<small>AGREED TOTAL</small></span></div>
        <div className="milestone-list compact-milestones">
          {demoProject.milestones.map((milestone, index) => <div className="milestone-row" key={milestone.id}><div className={`milestone-marker ${milestone.status === "Approved" ? "marker-done" : milestone.status === "In progress" ? "marker-active" : ""}`}>{milestone.status === "Approved" ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</div><div className="milestone-info"><strong>{milestone.title}</strong><span>{milestone.description}</span></div><div className="milestone-row-meta"><StatusPill status={milestone.status} /><strong>{formatMoney(milestone.amountCents)}</strong></div></div>)}
        </div>
        <Link to="/app/projects/studio-website" className="card-bottom-link">Open project details <ArrowRight size={15} /></Link>
      </section>

      <section className="surface-card attention-card">
        <SectionHeading title={isClient ? "Your review queue" : "Needs a closer look"} subtitle="An illustrative scope request." />
        <div className="request-preview-card"><div className="request-label-row"><span className="request-type"><Sparkles size={13} /> SCOPE REQUEST</span><span className="sample-mini-tag"><span /> SAMPLE</span></div><h3>Add appointment booking</h3><p>“Could we add a way for customers to pick a time for an intro call?”</p><div className="request-by"><span className="mini-avatar">NS</span><span><strong>Northstar Studio</strong><small>Received just now · sample</small></span></div><Link to="/app/scope" className="button-primary request-review-button">Review against scope <ArrowRight size={15} /></Link></div>
        <div className="attention-footnote"><FileClock size={15} /><span>No agreement changes until both parties review and approve.</span></div>
      </section>
    </div>

    <section className="surface-card activity-card">
      <SectionHeading title="Project rhythm" subtitle="A helpful summary of the sample workflow." link={<button className="quiet-button" type="button" onClick={() => notify("Activity history will be backed by the project audit log in Phase 2.")}>View activity <ArrowUpRight size={14} /></button>} />
      <div className="activity-steps"><ActivityStep icon={<Check size={15} />} tone="done" title="Agreement accepted" detail="Both parties approved version 1" time="OCT 22" /><ActivityStep icon={<FileText size={15} />} tone="active" title="Discovery & wireframes" detail="Approved milestone · $150" time="OCT 27" /><ActivityStep icon={<Sparkles size={15} />} tone="pending" title="New scope request" detail="Appointment booking · sample analysis" time="TODAY" /></div>
    </section>
    <div className="dashboard-note"><CalendarDays size={15} /><span>Sample dates are for interface preview and do not represent a live project schedule.</span><Link to="/app/scope">See scope review <MoveUpRight size={13} /></Link></div>
  </>;
}

function StatCard({ label, value, icon, tone, note, small = false }: { label: string; value: string; icon: ReactNode; tone: string; note: string; small?: boolean }) {
  return <article className="stat-card"><div className="stat-card-top"><span className={`stat-card-icon tone-${tone}`}>{icon}</span><span className="stat-card-label">{label}</span></div><strong className={`stat-card-value${small ? " stat-card-small" : ""}`}>{value}</strong><span className="stat-card-note">{note}</span></article>;
}

function ActivityStep({ icon, tone, title, detail, time }: { icon: ReactNode; tone: string; title: string; detail: string; time: string }) {
  return <div className="activity-step"><span className={`activity-icon activity-${tone}`}>{icon}</span><div><strong>{title}</strong><p>{detail}</p></div><time>{time}</time></div>;
}
