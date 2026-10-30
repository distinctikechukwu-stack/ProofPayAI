import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, ArrowUpRight, Check, CircleDollarSign, Clock3, FileText, Info, LockKeyhole, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { DemoNotice, PageHeading, SectionHeading, StatusPill } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { ApiError, apiRequest } from "../lib/api";
import type { HourlyInvoiceCandidate, InvoiceRecord, InvoicesResponse, PayableMilestone } from "../types/invoices";

type Action = { kind: "create"; source: "milestone"; candidate: PayableMilestone }
  | { kind: "create"; source: "hourly"; candidate: HourlyInvoiceCandidate }
  | { kind: "send" | "reconcile"; invoice: InvoiceRecord };

export function InvoicesPage() {
  const { user } = useAuth();
  const [data, setData] = useState<InvoicesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setData(await apiRequest<InvoicesResponse>("/api/invoices"));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load your invoice records.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh, retryKey]);

  const invoiceCounts = useMemo(() => {
    const invoices = data?.invoices ?? [];
    return {
      awaiting: invoices.filter((invoice) => ["sent", "scheduled", "payment_pending", "partially_paid"].includes(invoice.status)).length,
      paid: invoices.filter((invoice) => invoice.status === "paid").length,
    };
  }, [data]);

  async function runAction(action: Action) {
    setBusyId(action.kind === "create" ? action.source === "hourly" ? action.candidate.projectId : action.candidate.milestoneId : action.invoice.id);
    setError("");
    setNotice("");
    try {
      if (action.kind === "create") {
        const endpoint = action.source === "hourly"
          ? `/api/invoices/hourly/projects/${action.candidate.projectId}/create`
          : `/api/invoices/milestones/${action.candidate.milestoneId}/create`;
        const result = await apiRequest<{ outcome: string }>(endpoint, { method: "POST" });
        setNotice(result.outcome === "unknown"
          ? "PayPal has not confirmed invoice creation. Reconcile the saved operation before retrying."
          : "PayPal Sandbox draft invoice created and saved.");
      } else if (action.kind === "send") {
        const result = await apiRequest<{ outcome: string }>(`/api/invoices/${action.invoice.id}/send`, { method: "POST" });
        setNotice(result.outcome === "unknown"
          ? "The send result is unknown. Reconcile the saved operation before retrying."
          : "PayPal reports the invoice was sent to the client.");
      } else {
        const result = await apiRequest<{ outcome: string; message?: string }>(`/api/invoices/${action.invoice.id}/reconcile`, { method: "POST" });
        setNotice(result.message ?? (result.outcome === "unknown" ? "PayPal has not confirmed a final outcome yet." : "Invoice state refreshed from PayPal Sandbox."));
      }
      setConfirmation(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The invoice action could not be completed.");
      setConfirmation(null);
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  return <>
    <PageHeading eyebrow="PAYMENTS · PAYPAL SANDBOX" title="Invoices" description="Create invoices for approved milestones or hourly entries, confirm sending separately, and read payment state from verified provider updates." action={user ? <button className="button-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Refresh records</button> : undefined} />
    {!user ? <>
      <DemoNotice>This is a product preview only. It illustrates the invoice flow; no invoice, provider link, or payment record exists.</DemoNotice>
      <section className="invoice-setup-banner"><div className="invoice-setup-icon"><CircleDollarSign size={22} /></div><div><span className="eyebrow">PAYPAL INVOICING V2</span><h2>Invoices follow approved project milestones.</h2><p>Freelancers confirm draft creation, review the draft, then confirm sending to the client. Payment status comes from PayPal.</p></div><StatusPill status="Sandbox preview" /></section>
      <section className="surface-card invoice-flow-card"><SectionHeading title="Two confirmations, then verified payment" subtitle="The connected workflow keeps project approval and provider payment state separate." /><div className="invoice-flow-steps"><FlowStep number="01" title="Create a draft" detail="An eligible, client-approved milestone is copied into a PayPal Sandbox draft." /><FlowStep number="02" title="Review and send" detail="The freelancer confirms a separate action that sends the invoice to the project client." /><FlowStep number="03" title="Pay in Sandbox" detail="The client completes payment in PayPal's hosted Sandbox experience." /><FlowStep number="04" title="Verify the update" detail="A verified webhook and current invoice read update persisted provider state." /></div></section>
    </> : loading ? <section className="surface-card invoice-empty-state" aria-live="polite"><strong>Loading invoices from your workspace…</strong></section>
      : error ? <section className="surface-card invoice-empty-state" role="alert"><AlertCircle size={20} /><strong>Invoice records are unavailable</strong><p>{error}</p><button className="button-secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}>Try again</button></section>
        : data && <>
          {!data.integrations.invoiceOperations && <DemoNotice>PayPal invoice actions are not configured. Add server-side Sandbox credentials and Supabase service-role access; no create or send request has been made.</DemoNotice>}
          {data.integrations.invoiceOperations && !data.integrations.webhook && <div className="invoice-integration-warning"><Info size={16} /><span>Sandbox invoice actions are configured, but verified payment updates are not. Set a PayPal webhook ID and register this API at a public HTTPS URL before accepting webhook events.</span></div>}
          <section className="invoice-setup-banner"><div className="invoice-setup-icon"><CircleDollarSign size={22} /></div><div><span className="eyebrow">PAYPAL INVOICING V2</span><h2>{data.integrations.paypalSandbox ? "Sandbox invoicing is configured." : "PayPal Sandbox is not configured."}</h2><p>Invoices and project milestones have separate states. Only verified provider updates can mark an invoice paid.</p></div><StatusPill status={data.integrations.invoiceOperations ? "Sandbox ready" : "Not configured"} /></section>
          <div className="invoice-stats-grid"><InvoiceStat label="Invoice records" value={String(data.invoices.length)} note="Visible to your account" icon={<FileText size={17} />} /><InvoiceStat label="Awaiting payment" value={String(invoiceCounts.awaiting)} note="Sent or pending at PayPal" icon={<RefreshCw size={17} />} /><InvoiceStat label="Paid at PayPal" value={String(invoiceCounts.paid)} note="Provider reports fully paid" icon={<Check size={17} />} /></div>

          {confirmation && <section className="surface-card invoice-confirm-card" aria-labelledby="invoice-confirm-title">
            <div className="invoice-confirm-icon"><LockKeyhole size={18} /></div>
            <div className="invoice-confirm-copy"><span className="eyebrow">CONFIRM PAYPAL ACTION</span>
              <h2 id="invoice-confirm-title">{confirmation.kind === "create" ? "Create a Sandbox draft invoice?" : "Send this invoice to the client?"}</h2>
              <p>{confirmation.kind === "create"
                ? confirmation.source === "hourly"
                  ? `${confirmation.candidate.projectTitle} · ${formatApprovedTime(confirmation.candidate.approvedSeconds)} approved · ${formatMinor(confirmation.candidate.amountMinor, confirmation.candidate.currency)}`
                  : `${confirmation.candidate.projectTitle} · ${confirmation.candidate.milestoneTitle} · ${formatMinor(confirmation.candidate.amountMinor, confirmation.candidate.currency)}`
                : `${confirmation.invoice.projectTitle} · ${confirmation.invoice.invoiceNumber} · ${formatMinor(confirmation.invoice.amountMinor, confirmation.invoice.currency)}`}</p>
              {confirmation.kind === "create" && confirmation.source === "hourly" && <p className="invoice-confirm-warning">The amount comes from the accepted hourly rate and approved entries. The server selects the entries and calculates the total.</p>}
              {confirmation.kind === "send" && <p className="invoice-confirm-warning">PayPal will email the invoice to the approved project client. This action is separate from draft creation.</p>}
            </div>
            <div className="invoice-confirm-actions"><button className="button-text" type="button" onClick={() => setConfirmation(null)} disabled={Boolean(busyId)}>Cancel</button><button className="button-primary" type="button" onClick={() => void runAction(confirmation)} disabled={Boolean(busyId)}>{busyId ? "Working…" : confirmation.kind === "create" ? "Create draft" : "Confirm send"}</button></div>
          </section>}

          {error && <div className="invoice-action-message is-error" role="alert"><AlertCircle size={16} />{error}</div>}
          {notice && <div className="invoice-action-message" role="status"><ShieldCheck size={16} />{notice}</div>}

          <section className="surface-card invoice-queue-card"><SectionHeading title="Milestones eligible for invoicing" subtitle="Only current accepted agreements and client-approved milestones appear here." />
            {data.candidates.length ? <div className="invoice-candidate-list">{data.candidates.map((candidate) => <article className="invoice-eligible-row" key={candidate.milestoneId}>
              <span className="invoice-project-icon"><FileText size={17} /></span><div className="invoice-eligible-project"><strong>{candidate.projectTitle}</strong><span>{candidate.clientName} · {candidate.milestoneTitle}</span></div><div className="invoice-eligible-status"><StatusPill status="Approved" /><small>Milestone workflow</small></div><div className="invoice-eligible-amount"><strong>{formatMinor(candidate.amountMinor, candidate.currency)}</strong><small>{candidate.currency}{candidate.dueDate ? ` · due ${formatDate(candidate.dueDate)}` : " · approved milestone"}</small></div><button className="button-primary" type="button" onClick={() => { setError(""); setConfirmation({ kind: "create", source: "milestone", candidate }); }} disabled={!data.integrations.invoiceOperations || Boolean(busyId)} title={!data.integrations.invoiceOperations ? "Configure PayPal Sandbox and Supabase service access first" : undefined}>Create draft</button>
            </article>)}</div> : <div className="invoice-empty-inline"><Check size={17} /><span>No approved milestones are currently eligible for invoice creation.</span></div>}
            <div className="invoice-queue-foot"><LockKeyhole size={14} /><span>Create and send operations use committed claims. An unknown provider result must be reconciled before a retry.</span></div>
          </section>

          <section className="surface-card invoice-queue-card"><SectionHeading title="Approved hourly work" subtitle="The server batches unreserved, client-approved entries and calculates the amount from the accepted rate." />
            {data.hourlyCandidates.length ? <div className="invoice-candidate-list">{data.hourlyCandidates.map((candidate) => <article className="invoice-eligible-row" key={candidate.projectId}>
              <span className="invoice-project-icon"><Clock3 size={17} /></span><div className="invoice-eligible-project"><strong>{candidate.projectTitle}</strong><span>{candidate.clientName} · {candidate.entryCount} approved entries · {candidate.workDateStart}–{candidate.workDateEnd}</span></div><div className="invoice-eligible-status"><StatusPill status="Approved" /><small>{formatApprovedTime(candidate.approvedSeconds)} at {formatMinor(candidate.hourlyRateMinor, candidate.currency)} / hour</small></div><div className="invoice-eligible-amount"><strong>{formatMinor(candidate.amountMinor, candidate.currency)}</strong><small>Approved-time total</small></div><button className="button-primary" type="button" onClick={() => { setError(""); setConfirmation({ kind: "create", source: "hourly", candidate }); }} disabled={!data.integrations.invoiceOperations || Boolean(busyId)} title={!data.integrations.invoiceOperations ? "Configure PayPal Sandbox and Supabase service access first" : undefined}>Create draft</button>
            </article>)}</div> : <div className="invoice-empty-inline"><Check size={17} /><span>No approved, uninvoiced hourly entries are currently eligible.</span></div>}
          </section>

          <section className="surface-card invoice-history-card"><SectionHeading title="Invoice history" subtitle="Provider payment state stays independent from milestone approval." />
            {data.invoices.length ? <div className="invoice-history-list">{data.invoices.map((invoice) => <article className="invoice-history-row" key={invoice.id}>
              <div className="invoice-history-icon"><FileText size={17} /></div><div className="invoice-history-main"><strong>{invoice.projectTitle}</strong><span>{invoice.sourceType === "hourly" ? "Approved hourly work" : "Approved milestone"} · {invoice.invoiceNumber} · {formatMoney(invoice.amountMinor, invoice.currency)}</span><small>{invoice.providerStatus ? `PayPal ${invoice.providerStatus.replaceAll("_", " ").toLowerCase()}` : "Provider state pending"}{invoice.paidAt ? ` · paid ${formatDate(invoice.paidAt)}` : ""}</small></div><StatusPill status={invoice.status.replaceAll("_", " ")} />
              {invoice.invoiceUrl && <a className="button-text invoice-provider-link" href={invoice.invoiceUrl} target="_blank" rel="noreferrer">Open PayPal invoice <ArrowUpRight size={14} /></a>}
              {invoice.status === "draft" && <button className="button-secondary" type="button" onClick={() => { setError(""); setConfirmation({ kind: "send", invoice }); }} disabled={!data.integrations.invoiceOperations || Boolean(busyId)} title={!data.integrations.invoiceOperations ? "Configure PayPal Sandbox and Supabase service access first" : undefined}><Send size={14} /> Send to client</button>}
              {["unknown", "create_pending", "send_pending"].includes(invoice.status) && <button className="button-secondary" type="button" onClick={() => void runAction({ kind: "reconcile", invoice })} disabled={!data.integrations.invoiceOperations || Boolean(busyId)} title={!data.integrations.invoiceOperations ? "Configure PayPal Sandbox and Supabase service access first" : undefined}>{busyId === invoice.id ? "Checking…" : "Reconcile"}</button>}
            </article>)}</div> : <div className="invoice-empty-inline"><FileText size={17} /><span>No persisted PayPal invoice records are visible to your account yet.</span></div>}
          </section>
          <section className="surface-card invoice-security-note"><ShieldCheck size={18} /><div><strong>Payment verification</strong><p>Buttons in ProofPay never mark an invoice paid. A verified PayPal webhook is checked against the current Sandbox invoice before payment state is saved.</p></div></section>
        </>}
  </>;
}

function InvoiceStat({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <article className="surface-card invoice-stat"><span className="invoice-stat-icon">{icon}</span><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function FlowStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <article className="flow-step"><span>{number}</span><strong>{title}</strong><p>{detail}</p></article>;
}

function formatMinor(value: string, currency: string): string {
  try {
    const minor = BigInt(value);
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const divisor = 10n ** BigInt(digits);
    const whole = minor / divisor;
    const fraction = (minor % divisor).toString().padStart(digits, "0");
    if (minor <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / Number(divisor));
    }
    return `${currency} ${whole.toString()}${digits ? `.${fraction}` : ""}`;
  } catch {
    return `${currency} —`;
  }
}

function formatMoney(value: string, currency: string): string {
  return formatMinor(value, currency);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString();
}

function formatApprovedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
}
