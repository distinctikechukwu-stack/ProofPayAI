import { CalendarDays, CheckCircle2, Circle, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DemoNotice, PageHeading } from "../components/WorkspacePrimitives";
import { demoProject } from "../data/demo";
import { useAuth } from "../contexts/AuthContext";
import { ApiError, apiRequest } from "../lib/api";
import type { TimelineEntry, TimelineResponse } from "../types/timeline";

export function TimelinePage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!user) {
      setEntries([]);
      setLoading(false);
      setError("");
      return;
    }
    let active = true;
    setEntries([]);
    setLoading(true);
    setError("");
    void apiRequest<TimelineResponse>("/api/timeline").then((result) => {
      if (!active) return;
      setEntries(result.entries);
      setError("");
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof ApiError ? cause.message : "Could not load your milestone timeline.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [retryKey, user]);

  const displayEntries = useMemo(() => {
    if (user) return sortEntries(entries);
    return demoProject.milestones.map((milestone, index) => ({
      projectId: demoProject.id,
      projectTitle: demoProject.name,
      clientName: demoProject.client,
      projectStatus: "in_progress",
      milestoneId: milestone.id,
      sequence: index + 1,
      title: milestone.title,
      status: milestone.status === "Approved" ? "approved" : milestone.status === "In progress" ? "in_progress" : "draft",
      dueDate: milestone.dueDate,
      amountMinor: String(milestone.amountCents),
      currency: demoProject.currency,
    }));
  }, [entries, user]);

  const groups = groupByProject(displayEntries);

  return <>
    <PageHeading eyebrow="PROJECT SCHEDULE" title="Timeline" description="Track milestone dates and delivery status across your active projects." />
    {!user && <DemoNotice>This timeline uses the illustrative Studio Website Refresh sample project. Sign in to load milestones visible to your account.</DemoNotice>}
    {loading ? <section className="surface-card timeline-empty" aria-live="polite"><strong>Loading your milestones…</strong></section>
      : error ? <section className="surface-card timeline-empty" role="alert"><strong>Timeline is unavailable</strong><p>{error}</p><button className="button-secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}>Try again</button></section>
        : groups.length ? groups.map((group) => <section className="surface-card timeline-project-card" key={group.projectId}>
          <div className="timeline-project-heading">
            <span className="timeline-project-icon"><CalendarDays size={16} /></span>
            <div><span className="eyebrow">{group.clientName} · {group.projectStatus.replaceAll("_", " ")}</span><h2>{group.projectTitle}</h2></div>
            <span className="timeline-project-count">{group.entries.length} milestones</span>
          </div>
          <ol className="milestone-timeline">
            {group.entries.map((entry, index) => <li className={"timeline-item timeline-" + timelineStatus(entry.status)} key={entry.milestoneId}>
              <div className="timeline-date">{entry.dueDate ? formatDate(entry.dueDate) : "No due date"}</div>
              <span className="timeline-marker" aria-hidden="true">{entry.status === "approved" ? <CheckCircle2 size={17} /> : entry.status === "in_progress" ? <Clock3 size={17} /> : <Circle size={15} />}</span>
              <div className="timeline-milestone">
                <span className="timeline-sequence">MILESTONE {entry.sequence}</span>
                <strong>{entry.title}</strong>
                <span className="timeline-milestone-meta"><span className={"status-pill " + statusClass(entry.status)}>{entry.status.replaceAll("_", " ")}</span><span>{formatMinor(entry.amountMinor, entry.currency)}</span></span>
              </div>
              {index < group.entries.length - 1 && <span className="timeline-connector" aria-hidden="true" />}
            </li>)}
          </ol>
        </section>) : <section className="surface-card timeline-empty"><strong>No milestones have been scheduled yet.</strong><p>Project dates will appear here when a signed-in project has milestone records.</p></section>}
  </>;
}

function sortEntries(entries: TimelineEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.dueDate === null && b.dueDate !== null) return 1;
    if (a.dueDate !== null && b.dueDate === null) return -1;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.sequence - b.sequence;
  });
}

function groupByProject(entries: TimelineEntry[]) {
  const groups = new Map<string, { projectId: string; projectTitle: string; clientName: string; projectStatus: string; entries: TimelineEntry[] }>();
  for (const entry of entries) {
    const current = groups.get(entry.projectId) ?? {
      projectId: entry.projectId,
      projectTitle: entry.projectTitle,
      clientName: entry.clientName,
      projectStatus: entry.projectStatus,
      entries: [],
    };
    current.entries.push(entry);
    groups.set(entry.projectId, current);
  }
  return [...groups.values()];
}

function timelineStatus(value: string): string {
  return value === "approved" ? "complete" : value === "in_progress" || value === "submitted_for_review" ? "active" : "upcoming";
}

function statusClass(value: string): string {
  return value === "approved" ? "status-success" : value === "in_progress" || value === "submitted_for_review" ? "status-progress" : "status-neutral";
}

function formatMinor(amountMinor: string, currency: string): string {
  try {
    const minor = BigInt(amountMinor);
    if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) return currency + " " + minor.toString() + " minor units";
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);
  } catch {
    return currency + " amount unavailable";
  }
}

function formatDate(value: string): string {
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
