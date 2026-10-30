import { useEffect, useState } from "react";
import { CircleHelp, RefreshCw, Settings2, ShieldCheck, Sparkles, UserRoundX } from "lucide-react";
import { DemoNotice, PageHeading } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { ApiError, apiRequest, publicApiRequest } from "../lib/api";

export function SettingsPage() {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<{ supabase: boolean; ai: boolean; paypal: boolean; paypalWebhook: boolean } | null>(null);
  const [deletionRequest, setDeletionRequest] = useState<{ id: string; status: string; created_at: string; resolution_note: string } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshDeletionRequest = async () => {
    if (!user) { setDeletionRequest(null); return; }
    try {
      const result = await apiRequest<{ request: { id: string; status: string; created_at: string; resolution_note: string } | null }>("/api/account/deletion");
      setDeletionRequest(result.request);
      setError("");
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Account request status is unavailable."); }
  };

  useEffect(() => {
    let active = true;
    void publicApiRequest<{ integrations: { supabase: boolean; ai: boolean; paypal: boolean; paypalWebhook: boolean } }>("/api/status")
      .then((result) => { if (active) setIntegrations(result.integrations); })
      .catch(() => { if (active) setIntegrations(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => { void refreshDeletionRequest(); }, [user]);

  const requestDeletion = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/api/account/deletion", { method: "POST", body: { confirmation } });
      setConfirmation(""); setNotice("Your account deletion request was recorded for manual review. Your account and records remain active until a separate, approved process is completed.");
      await refreshDeletionRequest();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The account request could not be saved."); }
    finally { setBusy(false); }
  };

  const cancelDeletion = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/api/account/deletion/cancel", { method: "POST" });
      setNotice("The pending request was cancelled. No data was deleted.");
      await refreshDeletionRequest();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The account request could not be cancelled."); }
    finally { setBusy(false); }
  };

  const integrationsList = [
    { name: "Supabase", detail: "Authentication, project records, and access controls", ready: integrations?.supabase ?? false, icon: Settings2 },
    { name: "AI provider", detail: "Structured milestone generation and scope review", ready: integrations?.ai ?? false, icon: Sparkles },
    { name: "PayPal Sandbox", detail: "Invoicing API v2 and verified webhooks", ready: integrations?.paypal ?? false, icon: ShieldCheck },
    { name: "PayPal webhooks", detail: "Signature verification for provider updates", ready: integrations?.paypalWebhook ?? false, icon: ShieldCheck },
  ];

  return <>
    <PageHeading eyebrow="ACCOUNT, PRIVACY & INTEGRATIONS" title="Settings" description="Review server-managed services and manage a request to delete your account." />
    {!user && <DemoNotice>Sign in to manage account privacy requests. Provider secrets belong in server configuration and must never be entered into browser forms.</DemoNotice>}
    {error && <p className="account-request-message is-error" role="alert">{error}</p>}
    {notice && <p className="account-request-message" role="status">{notice}</p>}
    <section className="surface-card settings-section">
      <h2>Integration setup</h2>
      <p>Status is read from server configuration; credentials remain private.</p>
      {integrationsList.map(({ name, detail, ready, icon: Icon }) => <div className="settings-integration-row" key={name}>
        <span className="settings-integration-icon"><Icon size={16} /></span>
        <span><strong>{name}</strong><small>{detail}</small></span>
        <span className={`status-pill ${ready ? "status-success" : "status-warning"}`}>{integrations ? ready ? "Configured" : "Not configured" : "Status unavailable"}</span>
      </div>)}
    </section>
    <section className="surface-card account-deletion-section">
      <div><span className="eyebrow">ACCOUNT DATA</span><h2><UserRoundX size={17} /> Request account deletion</h2><p>This request does not immediately delete your account. An operator reviews open projects, agreements, invoices, and applicable retention needs before any separate deletion process. PayPal records remain subject to provider rules.</p></div>
      {user ? <>
        {deletionRequest && ["requested", "under_review"].includes(deletionRequest.status) ? <div className="account-deletion-status"><strong>Request status: {deletionRequest.status.replaceAll("_", " ")}</strong><small>Submitted {formatSettingsDate(deletionRequest.created_at)}</small>{deletionRequest.resolution_note && <p>{deletionRequest.resolution_note}</p>}
          {deletionRequest.status === "requested" && <button type="button" className="button-secondary" disabled={busy} onClick={() => void cancelDeletion()}>{busy ? "Saving…" : "Cancel pending request"}</button>}
        </div> : <div className="account-deletion-form"><label>Type <strong>REQUEST DELETION</strong> to confirm<input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} /></label><button className="button-secondary" type="button" disabled={busy || confirmation !== "REQUEST DELETION"} onClick={() => void requestDeletion()}>{busy ? "Submitting…" : "Submit deletion request"}</button></div>}
      </> : <p className="account-deletion-signin">Sign in to submit an account request.</p>}
    </section>
    <div className="settings-help"><CircleHelp size={16} /><span>Provider setup instructions are in the project README. This page never accepts secrets.</span><button type="button" className="button-text" onClick={() => void refreshDeletionRequest()} disabled={!user || busy}><RefreshCw size={13} /> Refresh</button></div>
  </>;
}

function formatSettingsDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
