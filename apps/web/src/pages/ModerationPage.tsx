import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Flag, RefreshCw, ShieldCheck } from "lucide-react";
import { DemoNotice, PageHeading, SectionHeading, StatusPill } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { ApiError, apiRequest } from "../lib/api";
import type { ModerationQueue } from "@proofpay/shared";

export function ModerationPage() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!user) { setQueue(null); return; }
    setLoading(true); setError("");
    try { setQueue(await apiRequest<ModerationQueue>("/api/admin/moderation")); }
    catch (cause) {
      setQueue(null);
      setError(cause instanceof ApiError && cause.status === 403
        ? "This workspace is limited to administrators assigned by an operator."
        : cause instanceof ApiError ? cause.message : "The moderation queue could not be loaded.");
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const review = async (id: string, endpoint: string, body: unknown, success: string) => {
    setBusyId(id); setError(""); setNotice("");
    try {
      await apiRequest(endpoint, { method: "POST", body });
      setNotice(success);
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The review could not be saved.");
    } finally { setBusyId(""); }
  };

  const totalPending = (queue?.jobReports.filter((row) => row.status === "pending").length ?? 0)
    + (queue?.conversationReports.filter((row) => row.status === "pending").length ?? 0)
    + (queue?.deletionRequests.filter((row) => row.status === "requested").length ?? 0);

  if (!user) return <section className="moderation-empty"><h2>Sign in to open administrator tools.</h2><a className="button-primary" href="/signin">Sign in</a></section>;

  return <>
    <PageHeading eyebrow="ADMINISTRATION · PRIVATE" title="Moderation" description="Review reports and account requests. Every decision is checked on the server and recorded in an append-only audit log." action={<button className="button-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Refresh queue</button>} />
    <DemoNotice>Administrator access is granted by a trusted operator. Listing holds hide a job from public browsing; conversation review records a decision but does not automatically punish or restrict a user. Account deletion requests remain pending until the owner’s contract, payment, and data-retention obligations have been reviewed.</DemoNotice>
    {error && <p className="moderation-feedback is-error" role="alert"><AlertCircle size={15} />{error}</p>}
    {notice && <p className="moderation-feedback" role="status"><Check size={15} />{notice}</p>}
    {loading && !queue ? <section className="surface-card moderation-empty" role="status">Loading private review queue…</section> : queue && <>
      <section className="moderation-summary surface-card"><ShieldCheck size={18} /><span><strong>{totalPending} pending item{totalPending === 1 ? "" : "s"}</strong><small>Reviewed items remain visible below for audit context.</small></span></section>

      <section className="surface-card moderation-section"><SectionHeading title="Job listing reports" subtitle="Hide or restore a listing, record no action, or escalate for further review." />
        {queue.jobReports.length ? <div className="moderation-list">{queue.jobReports.map((report) => <article className="moderation-report-card" key={report.id}>
          <div className="moderation-card-heading"><span className="moderation-icon"><Flag size={16} /></span><div><strong>{report.jobTitle}</strong><small>{report.reason.replaceAll("_", " ")} · {formatDate(report.createdAt)}</small></div><StatusPill status={report.status === "pending" ? "Pending review" : report.decision?.replaceAll("_", " ") ?? "Reviewed"} /></div>
          {report.details && <p>{report.details}</p>}
          {report.status === "reviewed" && report.resolutionNote && <p className="moderation-resolution"><strong>Moderator note:</strong> {report.resolutionNote}</p>}
          {report.status === "pending" && <div className="moderation-actions"><label>Decision note<textarea maxLength={2000} value={notes[report.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.currentTarget.value }))} /></label><div>{report.moderationHold
            ? <button className="button-secondary" type="button" disabled={Boolean(busyId)} onClick={() => void review(report.id, `/api/admin/moderation/jobs/${report.id}`, { decision: "restore_listing", note: notes[report.id] ?? "" }, "Listing restored and report review recorded.")}>Restore listing</button>
            : <button className="button-secondary" type="button" disabled={Boolean(busyId)} onClick={() => void review(report.id, `/api/admin/moderation/jobs/${report.id}`, { decision: "hide_listing", note: notes[report.id] ?? "" }, "Listing hidden and report review recorded.")}>Hide listing</button>}
            <button className="button-text" type="button" disabled={Boolean(busyId)} onClick={() => void review(report.id, `/api/admin/moderation/jobs/${report.id}`, { decision: "no_action", note: notes[report.id] ?? "" }, "No-action decision recorded.")}>No action</button>
            <button className="button-text" type="button" disabled={Boolean(busyId)} onClick={() => void review(report.id, `/api/admin/moderation/jobs/${report.id}`, { decision: "escalate", note: notes[report.id] ?? "" }, "Report escalated and recorded.")}>Escalate</button>
          </div></div>}
        </article>)}</div> : <EmptyReview label="No job listing reports are available." />}
      </section>

      <section className="surface-card moderation-section"><SectionHeading title="Conversation reports" subtitle="The reported message excerpt is shown as text. Reviews are recorded without automatic user sanctions." />
        {queue.conversationReports.length ? <div className="moderation-list">{queue.conversationReports.map((report) => <article className="moderation-report-card" key={report.id}>
          <div className="moderation-card-heading"><span className="moderation-icon"><Flag size={16} /></span><div><strong>{report.projectTitle}</strong><small>{report.reason.replaceAll("_", " ")} · {formatDate(report.createdAt)}</small></div><StatusPill status={report.status === "pending" ? "Pending review" : report.decision ?? "Reviewed"} /></div>
          {report.reportedMessage && <blockquote>{report.reportedMessage}</blockquote>}
          {report.details && <p>{report.details}</p>}
          {report.status === "reviewed" && report.resolutionNote && <p className="moderation-resolution"><strong>Moderator note:</strong> {report.resolutionNote}</p>}
          {report.status === "pending" && <div className="moderation-actions"><label>Decision note<textarea maxLength={2000} value={notes[report.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.currentTarget.value }))} /></label><div><button className="button-secondary" type="button" disabled={Boolean(busyId)} onClick={() => void review(report.id, `/api/admin/moderation/conversations/${report.id}`, { decision: "no_action", note: notes[report.id] ?? "" }, "No-action decision recorded.")}>No action</button><button className="button-secondary" type="button" disabled={Boolean(busyId)} onClick={() => void review(report.id, `/api/admin/moderation/conversations/${report.id}`, { decision: "escalate", note: notes[report.id] ?? "" }, "Report escalated and recorded.")}>Escalate</button></div></div>}
        </article>)}</div> : <EmptyReview label="No conversation reports are available." />}
      </section>

      <section className="surface-card moderation-section"><SectionHeading title="Account deletion requests" subtitle="Requests can be moved to review or declined. This queue does not erase account or financial records." />
        {queue.deletionRequests.length ? <div className="moderation-list">{queue.deletionRequests.map((request) => <article className="moderation-report-card" key={request.id}>
          <div className="moderation-card-heading"><span className="moderation-icon"><ShieldCheck size={16} /></span><div><strong>{request.displayName}</strong><small>Requested {formatDate(request.createdAt)}</small></div><StatusPill status={request.status.replaceAll("_", " ")} /></div>
          {request.resolutionNote && <p className="moderation-resolution"><strong>Review note:</strong> {request.resolutionNote}</p>}
          {request.status === "requested" && <div className="moderation-actions"><label>Review note<textarea maxLength={2000} value={notes[request.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.currentTarget.value }))} /></label><div><button className="button-secondary" type="button" disabled={Boolean(busyId)} onClick={() => void review(request.id, `/api/admin/moderation/deletion-requests/${request.id}`, { decision: "under_review", note: notes[request.id] ?? "" }, "Account request moved to manual review.")}>Begin review</button><button className="button-text" type="button" disabled={Boolean(busyId)} onClick={() => void review(request.id, `/api/admin/moderation/deletion-requests/${request.id}`, { decision: "declined", note: notes[request.id] ?? "" }, "Account request declined and recorded.")}>Decline request</button></div></div>}
        </article>)}</div> : <EmptyReview label="No account deletion requests are waiting for review." />}
      </section>
    </>}
  </>;
}

function EmptyReview({ label }: { label: string }) {
  return <div className="moderation-empty-inline"><Check size={16} /><span>{label}</span></div>;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
