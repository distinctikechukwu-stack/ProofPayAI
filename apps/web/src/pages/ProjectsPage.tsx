import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import { DemoNotice, PageHeading, StatusPill } from "../components/WorkspacePrimitives";
import type { ShellContext } from "../components/AppShell";
import { demoProject, formatMoney } from "../data/demo";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, ApiError } from "../lib/api";

type Filter = "All projects" | "In progress" | "Needs review";
interface ProjectRecord {
  id: string;
  created_by: string;
  title: string;
  client_name: string;
  budget_minor: number | string;
  currency: string;
  contract_type: "fixed" | "hourly";
  deadline: string | null;
  status: string;
}

export function ProjectsPage() {
  const { role, openNewProject } = useOutletContext<ShellContext>();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("All projects");
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError("");
    try {
      const response = await apiRequest<{ projects: ProjectRecord[] }>("/api/projects");
      setProjects(response.projects);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "Could not load projects. Try again shortly.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    window.addEventListener("proofpay:projects:refresh", refresh);
    return () => window.removeEventListener("proofpay:projects:refresh", refresh);
  }, [refresh, user]);

  const visibleDemo = useMemo(() => {
    const matchesSearch = `${demoProject.name} ${demoProject.client}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All projects" || (filter === "In progress" && demoProject.milestones.some((item) => item.status === "In progress")) || filter === "Needs review";
    return matchesSearch && matchesFilter;
  }, [filter, search]);
  const visibleProjects = useMemo(() => projects.filter((project) => {
    const matchesSearch = `${project.title} ${project.client_name}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All projects" || (filter === "In progress" && ["agreed", "in_progress"].includes(project.status)) || (filter === "Needs review" && project.status === "awaiting_client_agreement");
    return matchesSearch && matchesFilter;
  }), [filter, projects, search]);

  return <>
    <PageHeading eyebrow={role === "client" ? "CLIENT PROJECTS" : "YOUR WORKSPACE"} title="Projects" description="Keep scope, delivery, decisions, and next steps close together." action={<button className="button-primary" type="button" onClick={openNewProject}>Create project <span className="plus-symbol">+</span></button>} />
    {!user && <DemoNotice>This list contains one illustrative project. Sample records are separate from account data and are not persisted.</DemoNotice>}
    <section className="surface-card projects-list-card">
      <div className="project-list-toolbar"><div className="filter-tabs" role="group" aria-label="Filter projects">{(["All projects", "In progress", "Needs review"] as const).map((item) => <button key={item} type="button" className={`filter-tab${filter === item ? " selected" : ""}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}{item === "Needs review" && !user && <span>1</span>}</button>)}</div><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" aria-label="Search projects" /><SlidersHorizontal size={15} /></label></div>
      {user ? loading ? <div className="empty-filter"><strong>Loading your projects…</strong></div> : loadError ? <div className="empty-filter" role="alert"><strong>Projects are unavailable</strong><p>{loadError}</p><button type="button" className="button-secondary" onClick={() => void refresh()}>Try again</button></div> : visibleProjects.length ? visibleProjects.map((project) => <div className="project-list-row" key={project.id}><span className="project-list-icon">{project.client_name.slice(0, 2).toUpperCase()}</span><div className="project-list-title"><Link to={`/app/projects/${project.id}`}>{project.title}<ArrowUpRight size={13} /></Link><span>{project.client_name} · {project.contract_type === "hourly" ? "Hourly agreement" : "Fixed-price agreement"}</span></div><div className="project-list-progress"><span>Project status</span><strong>{project.status.replaceAll("_", " ")}</strong><div><i style={{ width: project.status === "completed" ? "100%" : project.status === "draft" ? "8%" : "34%" }} /></div></div><div className="project-list-status"><StatusPill status={project.status === "awaiting_client_agreement" ? "Awaiting review" : project.status === "completed" ? "Approved" : project.status === "draft" ? "Draft" : "In progress"} /><span>{project.deadline ? `Due ${project.deadline}` : "No deadline"}</span></div><strong className="project-list-amount">{formatMinor(project.budget_minor, project.currency)}{project.contract_type === "hourly" ? " / hr" : ""}</strong></div>) : <EmptyProjects hasUser search={search} onClear={() => { setSearch(""); setFilter("All projects"); }} /> : visibleDemo ? <div className="project-list-row"><span className="project-list-icon">NS</span><div className="project-list-title"><Link to="/app/projects/studio-website">{demoProject.name}<ArrowUpRight size={13} /></Link><span>{demoProject.client} · Illustrative sample</span></div><div className="project-list-progress"><span>Milestones</span><strong>1 of 3 approved</strong><div><i /></div></div><div className="project-list-status"><StatusPill status="In progress" /><span>Due {demoProject.deadlineLabel}</span></div><strong className="project-list-amount">{formatMoney(demoProject.budgetCents)}</strong></div> : <EmptyProjects hasUser={false} search={search} onClear={() => { setSearch(""); setFilter("All projects"); }} />}
    </section>
  </>;
}

function EmptyProjects({ hasUser, search, onClear }: { hasUser: boolean; search: string; onClear: () => void }) {
  return <div className="empty-filter"><span><Search size={18} /></span><strong>{hasUser ? "No projects yet" : "No matching sample projects"}</strong><p>{hasUser ? "Create a project draft to begin a persisted workspace." : search ? "Try another search or choose a different filter." : "Explore the sample project from the overview."}</p>{search && <button type="button" className="button-secondary" onClick={onClear}>Clear filters</button>}</div>;
}

function formatMinor(value: number | string, currency: string): string {
  try {
    const minor = BigInt(value);
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const divisor = 10n ** BigInt(digits);
    if (minor <= BigInt(Number.MAX_SAFE_INTEGER)) return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / Number(divisor));
    return `${currency} ${(minor / divisor).toString()}${digits ? `.${(minor % divisor).toString().padStart(digits, "0")}` : ""}`;
  } catch { return `${currency} amount unavailable`; }
}
