import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Check, Clock3, Pause, Play, Send, ShieldCheck, Square, TimerReset } from "lucide-react";
import { draftHourlyTimeEntrySchema, manualHourlyTimeEntrySchema, hourlyTimeEntryReviewSchema, hourlyTimerStartSchema } from "@proofpay/shared";
import { PageHeading, StatusPill } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, ApiError } from "../lib/api";

type Entry = {
  id: string; projectId: string; workDate: string; durationSeconds: number; description: string;
  source: "manual" | "timer"; status: "draft" | "submitted" | "approved" | "disputed";
  createdAt: string; submittedAt: string | null; isMine: boolean;
  reviewDecision: string | null; reviewDetails: string; reviewedAt: string | null;
};
type Timer = { id: string; description: string; state: "running" | "paused"; runningSince: string | null; elapsedSeconds: number };
type HourlyWorkspace = {
  contract: { projectId: string; hourlyRateMinor: string; currency: string; status: string; agreementVersionId: string; isFreelancer: boolean };
  entries: Entry[]; timer: Timer | null;
};
type Project = { id: string; title: string; contract_type: "fixed" | "hourly"; currency: string; status: string };

export function HourlyWorkPage() {
  const { projectId = "" } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [workspace, setWorkspace] = useState<HourlyWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [description, setDescription] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [hours, setHours] = useState("1");
  const [minutes, setMinutes] = useState("0");
  const [seconds, setSeconds] = useState("0");
  const [editingId, setEditingId] = useState("");
  const [timerDescription, setTimerDescription] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const idempotencyKeys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    if (!projectId) throw new Error("Project ID is missing.");
    const [projectResult, hourlyResult] = await Promise.all([
      apiRequest<{ project: Project }>(`/api/projects/${projectId}`),
      apiRequest<HourlyWorkspace>(`/api/projects/${projectId}/hourly`),
    ]);
    setProject(projectResult.project);
    setWorkspace(hourlyResult);
  }, [projectId]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let active = true;
    void refresh().catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Hourly work could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, refresh]);

  useEffect(() => {
    if (!workspace?.timer || workspace.timer.state !== "running") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [workspace?.timer?.id, workspace?.timer?.state]);

  const timerSeconds = useMemo(() => {
    const timer = workspace?.timer;
    if (!timer) return 0;
    const running = timer.state === "running" && timer.runningSince ? Math.max(0, Math.floor((now - Date.parse(timer.runningSince)) / 1000)) : 0;
    return timer.elapsedSeconds + running;
  }, [workspace?.timer, now]);

  const perform = async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "That hourly work action could not be saved."); }
    finally { setBusy(""); }
  };

  const saveEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hourCount = Number(hours); const minuteCount = Number(minutes); const secondCount = Number(seconds);
    const durationSeconds = hourCount * 3600 + minuteCount * 60 + secondCount;
    const maximumSeconds = editingId ? 604_800 : 86_400;
    if (!Number.isInteger(hourCount) || !Number.isInteger(minuteCount) || !Number.isInteger(secondCount)
      || hourCount < 0 || hourCount > (editingId ? 168 : 24) || minuteCount < 0 || minuteCount > 59 || secondCount < 0 || secondCount > 59
      || durationSeconds < 1 || durationSeconds > maximumSeconds) {
      setError(editingId ? "Enter a duration from 00:00:01 through 168:00:00." : "Enter a duration from 00:00:01 through 24:00:00."); return;
    }
    const values = { workDate, durationSeconds, description };
    const checked = draftHourlyTimeEntrySchema.safeParse(values);
    if (!checked.success) { setError("Review the date, duration, and work description."); return; }
    const fingerprint = JSON.stringify(values);
    const idempotencyKey = idempotencyKeys.current.get(fingerprint) ?? crypto.randomUUID();
    idempotencyKeys.current.set(fingerprint, idempotencyKey);
    void perform(editingId ? "edit-entry" : "save-entry", async () => {
      if (editingId) {
        await apiRequest(`/api/hourly/time-entries/${editingId}`, { method: "PATCH", body: values });
        setNotice("Draft time entry updated.");
      } else {
        const body = { ...values, idempotencyKey };
        const valid = manualHourlyTimeEntrySchema.parse(body);
        await apiRequest(`/api/projects/${projectId}/hourly/entries`, { method: "POST", body: valid });
        idempotencyKeys.current.delete(fingerprint);
        setNotice("Manual time entry saved as a draft. Review it before submitting to the client.");
      }
      setEditingId(""); setDescription(""); setHours("1"); setMinutes("0"); setSeconds("0");
      await refresh();
    });
  };

  const editEntry = (entry: Entry) => {
    setEditingId(entry.id); setDescription(entry.description); setWorkDate(entry.workDate);
    setHours(String(Math.floor(entry.durationSeconds / 3600)));
    setMinutes(String(Math.floor((entry.durationSeconds % 3600) / 60)));
    setSeconds(String(entry.durationSeconds % 60));
    setError(""); setNotice("");
  };

  const startTimer = () => void perform("start-timer", async () => {
    const parsed = hourlyTimerStartSchema.safeParse({ description: timerDescription });
    if (!parsed.success) throw new Error("Add a short description before starting the timer.");
    await apiRequest(`/api/projects/${projectId}/hourly/timer`, { method: "POST", body: parsed.data });
    setTimerDescription(""); setNotice("Timer started. It records only while you leave it running; pause or stop it when work pauses."); await refresh();
  });

  const controlTimer = (action: "pause" | "resume" | "stop") => void perform(`timer-${action}`, async () => {
    if (!workspace?.timer) return;
    const result = await apiRequest<{ state: string; entryId?: string }>(`/api/hourly/timers/${workspace.timer.id}`, { method: "POST", body: { action } });
    setNotice(action === "stop" ? "Timer stopped and saved as a draft time entry. Review it before sending it to the client." : `Timer ${action}d.`);
    if (action === "stop" && result.entryId) { setEditingId(""); }
    await refresh();
  });

  const submitEntry = (entry: Entry) => void perform(`submit-${entry.id}`, async () => {
    await apiRequest(`/api/hourly/time-entries/${entry.id}/submit`, { method: "POST" });
    setNotice("Time entry submitted for client review."); await refresh();
  });

  const reviewEntry = (entry: Entry, decision: "approved" | "disputed") => void perform(`review-${entry.id}`, async () => {
    const payload = { decision, details: reviewNotes[entry.id] ?? "" };
    const parsed = hourlyTimeEntryReviewSchema.safeParse(payload);
    if (!parsed.success) throw new Error(decision === "disputed" ? "Add at least eight characters explaining the dispute." : "Review details are too long.");
    await apiRequest(`/api/hourly/time-entries/${entry.id}/review`, { method: "POST", body: parsed.data });
    setNotice(decision === "approved" ? "Entry approved. It can now be included in an hourly invoice." : "Entry disputed. Its details remain visible in the review history and it cannot be invoiced.");
    await refresh();
  });

  if (!user) return <section className="hourly-empty"><h2>Sign in to open hourly project work.</h2><Link to="/signin" className="button-primary">Sign in</Link></section>;
  if (loading) return <section className="hourly-empty" role="status">Loading hourly work…</section>;
  if (error && !workspace) return <section className="hourly-empty" role="alert"><AlertCircle size={18} /><strong>Hourly work unavailable</strong><p>{error}</p><Link to="/app/projects">Back to projects</Link></section>;
  if (!workspace || !project || project.contract_type !== "hourly") return <section className="hourly-empty"><strong>This project does not have an hourly agreement.</strong><Link to={`/app/projects/${projectId}`}>Open project details</Link></section>;

  const active = workspace.contract.status === "active";
  const formattedRate = formatMinor(workspace.contract.hourlyRateMinor, workspace.contract.currency);
  const sortedEntries = [...workspace.entries].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt.localeCompare(a.createdAt));

  return <>
    <div className="back-link-row"><Link to={`/app/projects/${project.id}`}><ArrowLeft size={14} /> Project details</Link></div>
    <PageHeading eyebrow="HOURLY PROJECT WORK" title={project.title} description="Log time manually or with the project timer. The client reviews each submitted entry before it can be invoiced." action={<StatusPill status={active ? "Hourly contract active" : "Agreement review required"} />} />
    {error && <p className="hourly-feedback is-error" role="alert"><AlertCircle size={15} />{error}</p>}
    {notice && <p className="hourly-feedback" role="status"><Check size={15} />{notice}</p>}
    <section className="hourly-rate-card"><span><Clock3 size={17} /> AGREED HOURLY RATE</span><strong>{formattedRate}<small> / hour</small></strong><p>{active ? "Both parties have approved this hourly agreement." : "Time entry and timer actions unlock after both parties approve the agreement."} Only client-approved time can be included in an invoice.</p></section>

    <div className="hourly-work-grid">
      <section className="surface-card hourly-entry-panel">
        <div className="hourly-panel-heading"><span className="hourly-icon"><Clock3 size={17} /></span><div><h2>{workspace.contract.isFreelancer ? "Track project time" : "Review submitted time"}</h2><p>{workspace.contract.isFreelancer ? "Manual records and the optional timer stay under your control." : "Approve accurate entries or dispute them with a clear reason."}</p></div></div>
        {workspace.contract.isFreelancer && <>
          {workspace.timer ? <div className="hourly-timer-running"><div><span className="eyebrow">{workspace.timer.state === "running" ? "TIMER RUNNING" : "TIMER PAUSED"}</span><strong>{formatDuration(timerSeconds)}</strong><p>{workspace.timer.description}</p></div><div>{workspace.timer.state === "running" ? <button className="button-secondary" type="button" disabled={!active || Boolean(busy)} onClick={() => controlTimer("pause")}><Pause size={14} /> Pause</button> : <button className="button-secondary" type="button" disabled={!active || Boolean(busy)} onClick={() => controlTimer("resume")}><Play size={14} /> Resume</button>}<button className="button-primary" type="button" disabled={!active || Boolean(busy)} onClick={() => controlTimer("stop")}><Square size={13} /> Stop and save</button></div></div>
            : <form className="hourly-timer-form" onSubmit={(event) => { event.preventDefault(); startTimer(); }}><label>What are you working on?<input value={timerDescription} maxLength={1600} required placeholder="Example: Implementing the approved dashboard review" onChange={(event) => setTimerDescription(event.currentTarget.value)} /></label><button className="button-secondary" type="submit" disabled={!active || Boolean(busy)}><Play size={14} /> Start timer</button></form>}
          <form className="hourly-manual-form" onSubmit={saveEntry}>
            <h3>{editingId ? "Edit draft time entry" : "Add time manually"}</h3>
            <div className="hourly-manual-grid"><label>Work date<input type="date" required value={workDate} onChange={(event) => setWorkDate(event.currentTarget.value)} /></label><div className="hourly-duration-fields"><label>Hours<input aria-label="Hours" type="number" min="0" max={editingId ? 168 : 24} step="1" value={hours} onChange={(event) => setHours(event.currentTarget.value)} /></label><span>:</span><label>Minutes<input aria-label="Minutes" type="number" min="0" max="59" step="1" value={minutes} onChange={(event) => setMinutes(event.currentTarget.value)} /></label><span>:</span><label>Seconds<input aria-label="Seconds" type="number" min="0" max="59" step="1" value={seconds} onChange={(event) => setSeconds(event.currentTarget.value)} /></label></div></div>
            <label>Work description<textarea required maxLength={1600} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="Describe the work completed for this project" /></label>
            <div className="hourly-form-footer"><span>{editingId ? "Edited entries can be up to seven days; manual entries are limited to 24 hours." : "Duration format: hours, minutes, seconds. Drafts can be edited before submission."}</span>{editingId && <button type="button" className="button-text" onClick={() => { setEditingId(""); setDescription(""); }}>Cancel edit</button>}<button type="submit" className="button-primary" disabled={!active || Boolean(busy)}>{busy === "save-entry" || busy === "edit-entry" ? "Saving…" : editingId ? "Save draft" : "Add draft entry"}</button></div>
          </form>
        </>}
      </section>

      <section className="surface-card hourly-history-panel"><div className="hourly-panel-heading"><span className="hourly-icon"><TimerReset size={17} /></span><div><h2>Time entry history</h2><p>{workspace.entries.length} recent entries · submitted and reviewed records stay in history.</p></div><button className="button-text" type="button" disabled={Boolean(busy)} onClick={() => void perform("refresh", refresh)}>Refresh</button></div>
        {sortedEntries.length === 0 ? <div className="hourly-empty-inline"><strong>No time entries yet</strong><span>{workspace.contract.isFreelancer ? "Add a manual record or start the project timer." : "Submitted entries from the freelancer will appear here."}</span></div>
          : <div className="hourly-entry-list">{sortedEntries.map((entry) => <article className="hourly-entry-card" key={entry.id}>
            <div className="hourly-entry-top"><div><strong>{entry.workDate}</strong><span>{entry.source === "timer" ? "Timer record" : "Manual record"} · {formatDuration(entry.durationSeconds)}</span></div><StatusPill status={entry.status} /></div>
            <p>{entry.description}</p>
            {entry.reviewDetails && <div className={`hourly-review-note${entry.reviewDecision === "disputed" ? " is-disputed" : ""}`}><strong>{entry.reviewDecision === "disputed" ? "Client dispute" : "Client review"}</strong><span>{entry.reviewDetails}</span></div>}
            {workspace.contract.isFreelancer && entry.isMine && ["draft", "disputed"].includes(entry.status) && <div className="hourly-entry-actions"><button className="button-secondary" type="button" disabled={Boolean(busy)} onClick={() => editEntry(entry)}>{entry.status === "disputed" ? "Revise disputed entry" : "Edit draft"}</button>{entry.status === "draft" && <button className="button-primary" type="button" disabled={Boolean(busy)} onClick={() => submitEntry(entry)}><Send size={13} /> Submit to client</button>}</div>}
            {!workspace.contract.isFreelancer && entry.status === "submitted" && <div className="hourly-review-actions"><label>Review note<textarea maxLength={2000} value={reviewNotes[entry.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [entry.id]: event.currentTarget.value }))} placeholder="Optional approval note; required when disputing" /></label><div><button className="button-secondary" type="button" disabled={Boolean(busy)} onClick={() => reviewEntry(entry, "disputed")}>Dispute entry</button><button className="button-primary" type="button" disabled={Boolean(busy)} onClick={() => reviewEntry(entry, "approved")}><ShieldCheck size={14} /> Approve time</button></div></div>}
          </article>)}</div>}
      </section>
    </div>
  </>;
}

function formatMinor(value: string, currency: string): string {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const minor = BigInt(value); const divisor = 10n ** BigInt(digits);
    if (minor <= BigInt(Number.MAX_SAFE_INTEGER)) return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(minor) / Number(divisor));
    return `${currency} ${(minor / divisor).toString()}${digits ? `.${(minor % divisor).toString().padStart(digits, "0")}` : ""}`;
  } catch { return `${currency} —`; }
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600); const minutes = Math.floor((whole % 3600) / 60); const secs = whole % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
