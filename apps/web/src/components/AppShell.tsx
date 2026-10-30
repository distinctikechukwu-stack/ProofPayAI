import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity, ArrowUpRight, Bell, BriefcaseBusiness, CalendarDays, ChevronDown, CircleHelp, FileCheck2, FolderKanban,
  LayoutDashboard, MessageSquareText, Plus, ReceiptText, Settings2, ShieldCheck, Sparkles, Store, UserRound,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Brand } from "./Brand";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, ApiError } from "../lib/api";

export type WorkspaceRole = "freelancer" | "client";

export interface ShellContext {
  role: WorkspaceRole;
  setRole: (role: WorkspaceRole) => void;
  notify: (message: string) => void;
  openNewProject: () => void;
}

const primaryLinks = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/projects", label: "Projects", icon: FolderKanban },
  { to: "/app/messages", label: "Messages", icon: MessageSquareText },
  { to: "/app/scope", label: "Scope review", icon: Sparkles, badge: "1" },
  { to: "/app/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/app/opportunities", label: "Opportunities", icon: BriefcaseBusiness },
  { to: "/app/services", label: "Services", icon: Store },
];

const manageLinks = [
  { to: "/app/analytics", label: "Analytics", icon: Activity },
  { to: "/app/timeline", label: "Timeline", icon: CalendarDays },
  { to: "/app/profile", label: "Profile & roles", icon: UserRound },
  { to: "/app/settings", label: "Settings", icon: Settings2 },
];

export function AppShell() {
  const [role, setRole] = useState<WorkspaceRole>("freelancer");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const displayName = String(user?.user_metadata?.display_name ?? user?.email ?? (role === "freelancer" ? "Olivia Carter" : "Northstar Studio"));

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user) { setUnreadCount(null); setIsAdmin(false); return; }
    let active = true;
    const refreshUnread = () => {
      void apiRequest<{ unreadCount: number }>("/api/notifications?unreadOnly=true")
        .then((result) => { if (active) setUnreadCount(result.unreadCount); })
        .catch(() => { if (active) setUnreadCount(null); });
    };
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 45_000);
    window.addEventListener("proofpay:notifications:refresh", refreshUnread);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("proofpay:notifications:refresh", refreshUnread); };
  }, [user]);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    let active = true;
    void apiRequest<{ roles: string[] }>("/api/profile").then((profile) => {
      if (active) setIsAdmin(profile.roles.includes("admin"));
    }).catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, [user]);

  const notify = (message: string) => setToast(message);
  const pageTitle = location.pathname.includes("scope")
    ? "Scope review"
    : location.pathname.includes("invoices")
      ? "Invoices"
      : location.pathname.includes("projects")
        ? "Projects"
        : location.pathname.includes("messages")
          ? "Messages"
        : location.pathname.includes("analytics")
          ? "Analytics"
          : location.pathname.includes("timeline")
            ? "Timeline"
      : location.pathname.includes("opportunities")
        ? "Opportunities"
        : location.pathname.includes("services")
          ? "Services"
          : location.pathname.includes("profile")
            ? "Profile & roles"
          : location.pathname.includes("settings")
            ? "Settings"
            : location.pathname.includes("moderation")
              ? "Moderation"
            : "Overview";

  return (
    <div className="workspace-frame">
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand" aria-label="ProofPay AI home"><Brand inverse /></Link>

        <button className="workspace-switcher" type="button" onClick={() => setRole(role === "freelancer" ? "client" : "freelancer")}>
          <span className="workspace-avatar">{user ? displayName.slice(0, 2).toUpperCase() : role === "freelancer" ? "OC" : "NS"}</span>
          <span className="workspace-meta"><strong>{user ? displayName : role === "freelancer" ? "Olivia Carter" : "Northstar Studio"}</strong><small>{user ? "Signed-in account · sample records" : role === "freelancer" ? "Sample freelancer workspace" : "Sample client workspace"}</small></span>
          <ChevronDown size={15} className="sidebar-chevron" />
        </button>
        <p className="nav-label">WORKSPACE</p>
        <nav className="side-nav" aria-label="Main navigation">
          {primaryLinks.map(({ to, label, icon: Icon, ...props }) => (
            <NavLink key={to} to={to} end={props.end} className={({ isActive }: { isActive: boolean }) => `side-link${isActive ? " active" : ""}`}>
              <Icon size={17} strokeWidth={1.9} /><span>{label}</span>{props.badge && <span className="nav-badge">{props.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <button className="sidebar-new-project" type="button" onClick={() => setNewProjectOpen(true)}><Plus size={16} /><span>New project</span></button>
        <p className="nav-label nav-label-spaced">MANAGE</p>
        <nav className="side-nav" aria-label="Workspace management">
          {manageLinks.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }: { isActive: boolean }) => `side-link${isActive ? " active" : ""}`}>
              <Icon size={17} strokeWidth={1.9} /><span>{label}</span>
            </NavLink>
          ))}
          {isAdmin && <NavLink to="/app/moderation" className={({ isActive }: { isActive: boolean }) => `side-link${isActive ? " active" : ""}`}><ShieldCheck size={17} strokeWidth={1.9} /><span>Moderation</span></NavLink>}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-plan">
          <span className="plan-icon"><ShieldIcon /></span>
          <strong>Work with clarity</strong>
          <p>Keep scope, sign-offs, and payment steps in one place.</p>
          <Link to="/" className="plan-link">Explore ProofPay <ArrowUpRight size={13} /></Link>
        </div>
        <button className="support-link" type="button" onClick={() => notify("Help center preview — support links will be added with account setup.")}>
          <CircleHelp size={16} /><span>Help & support</span>
        </button>
        <div className="profile-row">
          <span className="profile-avatar">{user ? displayName.slice(0, 2).toUpperCase() : role === "freelancer" ? "OC" : "NS"}</span>
          <span className="profile-copy"><strong>{user ? displayName : role === "freelancer" ? "Olivia Carter" : "Northstar Studio"}</strong><small>{user ? "Signed in" : role === "freelancer" ? "Sample freelancer" : "Sample client"}</small></span>
          <button type="button" className="profile-more" aria-label={user ? "Sign out" : "Exit demo"} onClick={() => { if (!user) navigate("/"); else void signOut().then((result) => { if (result.error) notify(result.error); else navigate("/"); }); }}><ArrowUpRight size={15} /></button>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="mobile-top-brand"><Brand /></div>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <span className="demo-indicator"><span />{user ? "SIGNED IN" : "DEMO WORKSPACE"}</span>
            <button className="icon-button notification-button" type="button" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"} onClick={() => navigate("/app/messages#notifications")}><Bell size={17} />{unreadCount !== null && unreadCount > 0 && <i />}</button>
            <button className="role-toggle" type="button" onClick={() => setRole(role === "freelancer" ? "client" : "freelancer")} aria-label="Switch workspace role">
              <span className="role-toggle-dot" />{user ? "Sample " : ""}{role === "freelancer" ? "Freelancer view" : "Client view"}<ChevronDown size={14} />
            </button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {primaryLinks.map(({ to, label, icon: Icon, ...props }) => <NavLink key={to} to={to} end={props.end} className={({ isActive }: { isActive: boolean }) => `mobile-nav-link${isActive ? " active" : ""}`}><Icon size={16} /><span>{label}</span></NavLink>)}
          <NavLink to="/app/profile" className={({ isActive }: { isActive: boolean }) => `mobile-nav-link${isActive ? " active" : ""}`}><UserRound size={16} /><span>Profile</span></NavLink>
          {isAdmin && <NavLink to="/app/moderation" className={({ isActive }: { isActive: boolean }) => `mobile-nav-link${isActive ? " active" : ""}`}><ShieldCheck size={16} /><span>Admin</span></NavLink>}
        </nav>

        <main className="workspace-content">
          <Outlet context={{ role, setRole, notify, openNewProject: () => setNewProjectOpen(true) } satisfies ShellContext} />
          <footer className="workspace-footer"><span>ProofPay AI</span><span>Project clarity, from agreement to payment.</span><Link to="/">About ProofPay <ArrowUpRight size={12} /></Link></footer>
        </main>
      </div>

      {toast && <div className="toast-message" role="status"><span className="toast-dot" />{toast}</div>}
      {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} notify={notify} onCreated={(id) => navigate(`/app/projects/${id}`)} />}
      <button className="mobile-create-button" type="button" onClick={() => setNewProjectOpen(true)} aria-label="Create project"><Plus size={21} /></button>
    </div>
  );
}

function ShieldIcon() {
  return <FileCheck2 size={17} />;
}

function NewProjectDialog({ onClose, notify, onCreated }: { onClose: () => void; notify: (message: string) => void; onCreated: (projectId: string) => void }) {
  const { user } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestedMilestones, setSuggestedMilestones] = useState<Array<{
    sequence: number; title: string; description: string; deliverables: string[]; acceptanceCriteria: string[];
    completionConditions: string[]; allocationWeight: number; suggestedDueInDays: number | null;
    dependencySequences: number[]; amountMinor: number; dueDate: string | null;
  }> | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const updateMilestone = (index: number, updates: Partial<NonNullable<typeof suggestedMilestones>[number]>) => {
    setSuggestedMilestones((current) => current?.map((milestone, itemIndex) => itemIndex === index ? { ...milestone, ...updates } : milestone) ?? null);
  };
  const generateMilestones = async () => {
    if (!user || !formRef.current) return;
    const values = new FormData(formRef.current);
    const budgetMinor = decimalToMinor(String(values.get("budget") ?? ""));
    if (budgetMinor === null || budgetMinor < 1) {
      setMessage("Enter a positive budget before asking AI for milestone suggestions.");
      return;
    }
    setGenerating(true);
    setMessage("");
    try {
      const result = await apiRequest<{ milestones: NonNullable<typeof suggestedMilestones>; totalMinor: string }>("/api/ai/milestones", {
        method: "POST",
        body: {
          projectTitle: String(values.get("title") ?? "").trim(),
          projectDescription: String(values.get("description") ?? "").trim(),
          requirements: [String(values.get("description") ?? "").trim()],
          budgetMinor,
          currency: "USD",
        },
      });
      setSuggestedMilestones(result.milestones);
      setIdempotencyKey(crypto.randomUUID());
      setMessage("AI suggestions are editable and remain a draft until you review and save them.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "AI could not generate milestones. No project was changed.");
    } finally {
      setGenerating(false);
    }
  };
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      onClose();
      notify("This sample project preview was not saved to an account.");
      return;
    }
    const values = new FormData(event.currentTarget);
    const budgetMinor = decimalToMinor(String(values.get("budget") ?? ""));
    if (budgetMinor === null || budgetMinor < 1) {
      setMessage("Enter a positive budget with up to two decimal places.");
      return;
    }
    const milestones = suggestedMilestones?.map((milestone) => ({
      sequence: milestone.sequence,
      title: milestone.title,
      description: milestone.description,
      deliverables: milestone.deliverables,
      acceptanceCriteria: milestone.acceptanceCriteria,
      completionConditions: milestone.completionConditions,
      amountMinor: milestone.amountMinor,
      dueDate: milestone.dueDate,
      dependencySequences: milestone.dependencySequences,
    })) ?? [{
      sequence: 1,
      title: String(values.get("milestoneTitle") ?? "").trim(),
      description: String(values.get("milestoneDescription") ?? "").trim(),
      deliverables: [String(values.get("milestoneDeliverable") ?? "").trim()],
      acceptanceCriteria: ["The client confirms that the submitted work meets the written milestone criteria."],
      completionConditions: ["The client records an approval or requests a revision."],
      amountMinor: budgetMinor,
      dueDate: null,
      dependencySequences: [],
    }];
    if (milestones.some((milestone) => !Number.isSafeInteger(milestone.amountMinor) || milestone.amountMinor < 1)
      || milestones.reduce((sum, milestone) => sum + BigInt(milestone.amountMinor), 0n) !== BigInt(budgetMinor)) {
      setMessage("Adjust the milestone amounts so they equal the project budget exactly.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await apiRequest<{ projectId: string }>("/api/projects", {
        method: "POST",
        body: {
          idempotencyKey,
          title: String(values.get("title") ?? "").trim(),
          clientName: String(values.get("clientName") ?? "").trim(),
          description: String(values.get("description") ?? "").trim(),
          budgetMinor,
          currency: "USD",
          requirements: [String(values.get("description") ?? "").trim()],
          milestones,
        },
      });
      window.dispatchEvent(new Event("proofpay:projects:refresh"));
      onClose();
      notify("Project draft saved to your account.");
      onCreated(response.projectId);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not save this project. Your draft details are still here; try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div className="dialog-heading"><div><span className="eyebrow">NEW WORKSPACE PROJECT</span><h2 id="new-project-title">Start with a clear scope.</h2></div><button className="dialog-close" type="button" onClick={onClose} aria-label="Close dialog">×</button></div>
        <p className="dialog-copy">{user ? "Create a persisted draft with one editable starter milestone. Agreement sharing and AI generation are separate steps." : "Capture the basics in this preview. Sign in to save project records to an account."}</p>
        <form ref={formRef} onSubmit={handleSubmit} className="project-form">
          <label>Project name<input name="title" required minLength={3} maxLength={160} placeholder="e.g. Brand and website refresh" /></label>
          <label>Client name<input name="clientName" required maxLength={160} placeholder="Client or company" /></label>
          <label>Project description<textarea name="description" required minLength={2} maxLength={5000} placeholder="Describe the goals and work to be done." /></label>
          <div className="form-grid"><label>Project budget (USD)<input name="budget" required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="600.00" /></label><label>Currency<input value="USD" readOnly aria-label="Currency" /></label></div>
          {user && <button type="button" className="button-secondary" disabled={generating} onClick={() => void generateMilestones()}>{generating ? "Drafting suggestions…" : "Suggest milestones with AI"} <Sparkles size={14} /></button>}
          {suggestedMilestones ? <div className="milestone-suggestion-list"><p className="demo-form-note"><span />AI-generated draft · Review and edit every field. Amounts are exact minor-unit allocations; no agreement is shared by this action.</p>{suggestedMilestones.map((milestone, index) => <fieldset className="milestone-suggestion" key={milestone.sequence}><legend>Milestone {milestone.sequence} · {formatMinorInput(milestone.amountMinor)}</legend><label>Title<input value={milestone.title} required maxLength={120} onChange={(event) => updateMilestone(index, { title: event.target.value })} /></label><label>Description<textarea value={milestone.description} required maxLength={2000} onChange={(event) => updateMilestone(index, { description: event.target.value })} /></label><div className="form-grid"><label>Amount (USD)<input type="number" min="0.01" step="0.01" value={formatMinorInput(milestone.amountMinor)} onChange={(event) => { const amount = decimalToMinor(event.target.value); if (amount !== null) updateMilestone(index, { amountMinor: amount }); }} /></label><span className="milestone-suggestion-detail">Deliverables: {milestone.deliverables.join(" · ")}<br />Acceptance: {milestone.acceptanceCriteria.join(" · ")}<br />Completion: {milestone.completionConditions.join(" · ")}</span></div></fieldset>)}</div> : <><label>Starter milestone<input name="milestoneTitle" required minLength={1} maxLength={120} placeholder="Initial delivery" /></label><label>Milestone description<input name="milestoneDescription" required minLength={2} maxLength={2000} placeholder="What will be completed in this milestone?" /></label><label>Milestone deliverable<input name="milestoneDeliverable" required maxLength={500} placeholder="What will the client receive?" /></label></>}
          {!user && <div className="demo-form-note"><span />Preview only. This draft stays in this browser session and is not saved to Supabase.</div>}
          {message && <p role="alert" className="auth-message">{message}</p>}
          <div className="dialog-actions"><button className="button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : user ? "Save project draft" : "Preview project draft"} <ArrowUpRight size={15} /></button></div>
        </form>
      </section>
    </div>
  );
}

function decimalToMinor(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  try {
    const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
    return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
  } catch {
    return null;
  }
}

function formatMinorInput(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}
