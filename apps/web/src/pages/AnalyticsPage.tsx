import { BarChart3 } from "lucide-react";
import type { ColDef } from "ag-grid-community";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { DemoNotice, PageHeading } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, ApiError } from "../lib/api";
import type { AnalyticsGridRow, AnalyticsResponse } from "../types/analytics";

const AnalyticsGrid = lazy(() => import("../components/AnalyticsGrid").then((module) => ({ default: module.AnalyticsGrid })));

const analyticsTheme = {
  accentColor: "#5679b5",
  backgroundColor: "#ffffff",
  foregroundColor: "#41556f",
  headerBackgroundColor: "#f6f8fb",
  spacing: 8,
} as const;

const projectColumns: ColDef<AnalyticsGridRow>[] = [
  { field: "title", headerName: "Project", minWidth: 170, flex: 1.5 },
  { field: "status", headerName: "Status", minWidth: 125, valueFormatter: ({ value }) => typeof value === "string" ? value.replaceAll("_", " ") : "—" },
  { field: "budgetMinor", headerName: "Budget", minWidth: 125, valueFormatter: ({ data }) => data?.budgetMinor !== undefined ? formatMinor(data.budgetMinor, data.currency) : "—" },
  { field: "deadline", headerName: "Deadline", minWidth: 115, valueFormatter: ({ value }) => formatDate(value) },
];

const invoiceColumns: ColDef<AnalyticsGridRow>[] = [
  { field: "projectTitle", headerName: "Project", minWidth: 165, flex: 1.2 },
  { field: "invoiceNumber", headerName: "Invoice", minWidth: 140 },
  { field: "status", headerName: "Provider status", minWidth: 130 },
  { field: "amountMinor", headerName: "Amount", minWidth: 125, valueFormatter: ({ data }) => data?.amountMinor !== undefined ? formatMinor(data.amountMinor, data.currency) : "—" },
  { field: "createdAt", headerName: "Created", minWidth: 115, valueFormatter: ({ value }) => formatDate(value) },
];

export function AnalyticsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await apiRequest<AnalyticsResponse>("/api/analytics"));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load role-scoped analytics.");
    } finally {
      setLoading(false);
    }
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);

  return <>
    <PageHeading eyebrow="WORKSPACE INSIGHTS" title="Analytics" description="Understand project flow and invoice outcomes from your own records." />
    {!user ? <DemoNotice>Sign in to load project and invoice analytics. No demo revenue or payment outcomes are presented as real records.</DemoNotice>
      : loading ? <section className="analytics-empty surface-card" aria-live="polite"><strong>Loading your workspace analytics…</strong></section>
        : error ? <section className="analytics-empty surface-card" role="alert"><strong>Analytics are unavailable</strong><p>{error}</p><button type="button" className="button-secondary" onClick={() => void refresh()}>Try again</button></section>
          : data && <>
            <DemoNotice>Rows come from Supabase records visible to your signed-in account. Paid totals include only invoices currently marked paid in the database; no totals are inferred from draft or sent invoices.</DemoNotice>
            <section className="analytics-kpi-grid" aria-label="Workspace summary">
              <MetricCard label="Projects" value={String(data.summary.projectCount)} detail={`${data.summary.activeProjectCount} active`} />
              <MetricCard label="Milestones" value={String(data.summary.milestoneCount)} detail={`${data.summary.approvedMilestoneCount} approved`} />
              <MetricCard label="Invoices" value={String(data.summary.invoiceCount)} detail={`${data.summary.paidInvoiceCount} marked paid`} />
              <MetricCard label="Paid totals" value={data.summary.paidTotals.length ? data.summary.paidTotals.map((item) => formatMinor(item.amountMinor, item.currency)).join(" · ") : "No paid invoices"} detail="Persisted invoice state" />
            </section>
            <section className="surface-card analytics-grid-card">
              <div className="analytics-grid-heading"><div><span className="eyebrow">PROJECT RECORDS</span><h2>Your projects</h2></div><span>{data.projects.length} rows</span></div>
              <Suspense fallback={<GridLoading />}><AnalyticsGrid rowData={data.projects} columnDefs={projectColumns} theme={analyticsTheme} /></Suspense>
            </section>
            <section className="surface-card analytics-grid-card">
              <div className="analytics-grid-heading"><div><span className="eyebrow">PAYMENT RECORDS</span><h2>Invoice outcomes</h2></div><span>{data.invoices.length} rows</span></div>
              {data.invoices.length ? <Suspense fallback={<GridLoading />}><AnalyticsGrid rowData={data.invoices} columnDefs={invoiceColumns} theme={analyticsTheme} /></Suspense>
                : <div className="analytics-grid-empty"><BarChart3 size={17} /><p>No invoice records are available for this account yet.</p></div>}
            </section>
          </>}
  </>;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="analytics-metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function GridLoading() {
  return <div className="analytics-grid-shell analytics-grid-loading" role="status">Loading data grid…</div>;
}

function formatMinor(value: string | number, currency: string): string {
  try {
    const minor = BigInt(value);
    if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) return `${currency} ${minor.toString()} minor units`;
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);
  } catch {
    return `${currency} —`;
  }
}

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "—" : parsed.toLocaleDateString();
}
