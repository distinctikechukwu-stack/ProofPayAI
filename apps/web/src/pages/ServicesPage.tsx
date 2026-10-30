import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUpRight, Check, CircleAlert, Clock3, Eye, PackageOpen, Plus, Send, X } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeading, StatusPill } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, publicApiRequest } from "../lib/api";

type ServicePackage = { title: string; description: string; priceMinor: string; deliveryDays: number; deliverables: string[] };
type Service = {
  id: string; title: string; slug: string; description: string; category: string; startingPriceMinor: string; currency: string;
  deliveryDays: number; deliverables: string[]; packages: ServicePackage[]; portfolioItemIds: string[];
  isPublic: boolean; status: "draft" | "published" | "archived"; createdAt: string; updatedAt: string;
};
type PublicService = {
  id: string; freelancerSlug: string; freelancerName: string; slug: string; title: string; description: string;
  category: string; startingPriceMinor: string; currency: string; deliveryDays: number; deliverables: string[];
  packages: ServicePackage[];
};
type ServiceRequest = {
  id: string; serviceId: string; participantRole: "requester" | "provider"; requestText: string;
  budgetMinor: string | null; currency: string; status: string; createdAt: string; respondedAt: string | null;
};
type PortfolioRef = { id: string; title: string };
type Draft = {
  id: string | null; title: string; slug: string; description: string; category: string; startingPrice: string;
  currency: string; deliveryDays: string; deliverables: string; packages: ServicePackage[]; portfolioItemIds: string[]; isPublic: boolean;
};

const newPackage = (): ServicePackage => ({ title: "", description: "", priceMinor: "", deliveryDays: 7, deliverables: [""] });
const blankDraft = (): Draft => ({ id: null, title: "", slug: "", description: "", category: "", startingPrice: "", currency: "USD", deliveryDays: "7", deliverables: "", packages: [newPackage()], portfolioItemIds: [], isPublic: false });
const currencyDigits = (currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
};
function toMinor(text: string, currency: string): string | null {
  const digits = currencyDigits(currency);
  const expression = digits === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`);
  const parts = expression.exec(text.trim());
  if (!parts?.[1]) return null;
  try {
    const value = BigInt(parts[1]) * 10n ** BigInt(digits) + BigInt((parts[2] ?? "").padEnd(digits, "0") || "0");
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? value.toString() : null;
  } catch { return null; }
}
function fromMinor(value: string, currency: string): string {
  if (!/^\d+$/.test(value)) return "";
  const digits = currencyDigits(currency); const integer = BigInt(value); const divisor = 10n ** BigInt(digits);
  return digits ? `${integer / divisor}.${(integer % divisor).toString().padStart(digits, "0")}` : String(integer);
}
function money(value: string, currency: string): string {
  if (!/^\d+$/.test(value)) return "Price unavailable";
  const digits = currencyDigits(currency); const amount = BigInt(value); const divisor = 10n ** BigInt(digits);
  try {
    const whole = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount / divisor);
    return digits ? `${whole}.${(amount % divisor).toString().padStart(digits, "0")}` : whole;
  } catch { return `${currency} ${fromMinor(value, currency)}`; }
}
function lines(value: string): string[] { return value.split(/\r?\n|,/).map((part) => part.trim()).filter(Boolean); }
function serviceDraft(service: Service): Draft {
  return {
    id: service.id, title: service.title, slug: service.slug, description: service.description, category: service.category,
    startingPrice: fromMinor(service.startingPriceMinor, service.currency), currency: service.currency,
    deliveryDays: String(service.deliveryDays), deliverables: service.deliverables.join("\n"),
    packages: service.packages.map((item) => ({ ...item, priceMinor: fromMinor(item.priceMinor, service.currency) })),
    portfolioItemIds: service.portfolioItemIds, isPublic: service.isPublic,
  };
}

export function ServicesPage() {
  const { user } = useAuth();
  const [publicServices, setPublicServices] = useState<PublicService[]>([]);
  const [myServices, setMyServices] = useState<Service[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioRef[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [requesting, setRequesting] = useState<PublicService | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isFreelancer = roles.includes("freelancer");
  const isClient = roles.includes("client");

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    const tasks: Promise<void>[] = [publicApiRequest<{ services: PublicService[] }>("/api/services").then((result) => {
      if (current) setPublicServices(result.services);
    })];
    if (user) {
      tasks.push(apiRequest<{ roles: string[]; portfolio?: PortfolioRef[] }>("/api/profile").then((profile) => {
        if (current) { setRoles(profile.roles); setPortfolio(profile.portfolio ?? []); }
      }));
      tasks.push(apiRequest<{ services: Service[] }>("/api/services/mine").then((result) => { if (current) setMyServices(result.services); }));
      tasks.push(apiRequest<{ requests: ServiceRequest[] }>("/api/service-requests").then((result) => { if (current) setRequests(result.requests); }));
    } else {
      setRoles([]); setPortfolio([]); setMyServices([]); setRequests([]);
    }
    void Promise.all(tasks).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : "Service records could not be loaded.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refreshKey, user]);

  const categories = useMemo(() => [...new Set(publicServices.map((item) => item.category))].sort(), [publicServices]);
  const filtered = useMemo(() => publicServices.filter((service) => {
    const text = `${service.title} ${service.description} ${service.category} ${service.deliverables.join(" ")} ${service.freelancerName}`.toLocaleLowerCase();
    return (!query || text.includes(query.toLocaleLowerCase())) && (!category || service.category === category);
  }), [category, publicServices, query]);

  const saveService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!draft) return;
    setError(""); setSaving(true);
    const startingPriceMinor = toMinor(draft.startingPrice, draft.currency);
    const packageRows = draft.packages.map((item) => ({
      title: item.title.trim(), description: item.description.trim(), priceMinor: toMinor(item.priceMinor, draft.currency),
      deliveryDays: Number(item.deliveryDays), deliverables: item.deliverables.map((value) => value.trim()).filter(Boolean),
    }));
    const cleanSlug = (draft.slug || draft.title).trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const deliveryDays = Number(draft.deliveryDays);
    if (!startingPriceMinor || !/^[A-Z]{3}$/.test(draft.currency) || !Number.isSafeInteger(deliveryDays) || deliveryDays < 1 || packageRows.some((item) => !item.priceMinor || !Number.isSafeInteger(item.deliveryDays) || item.deliveryDays < 1 || !item.deliverables.length)) {
      setSaving(false); setError("Review the currency, exact prices, delivery days, package details, and deliverables."); return;
    }
    try {
      await apiRequest("/api/services", { method: "POST", body: {
        id: draft.id, title: draft.title, slug: cleanSlug, description: draft.description, category: draft.category,
        startingPriceMinor: Number(startingPriceMinor), currency: draft.currency, deliveryDays,
        deliverables: lines(draft.deliverables), packages: packageRows.map((item) => ({ ...item, priceMinor: Number(item.priceMinor) })),
        portfolioItemIds: draft.portfolioItemIds, isPublic: draft.isPublic,
      } });
      setDraft(null); setNotice("Service draft saved to your account."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The service could not be saved. Your changes are still open."); }
    finally { setSaving(false); }
  };

  const changeStatus = async (service: Service, action: "publish" | "unpublish" | "archive") => {
    setError("");
    try {
      await apiRequest(`/api/services/${service.id}/status`, { method: "POST", body: { action } });
      setNotice(action === "publish" ? "Service is published to the opt-in marketplace catalog." : action === "unpublish" ? "Service is no longer public." : "Service archived."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Service status could not be changed."); }
  };

  const requestService = async (event: FormEvent<HTMLFormElement>, service: PublicService, idempotencyKey: string): Promise<boolean> => {
    event.preventDefault(); setError("");
    const values = new FormData(event.currentTarget);
    const requestText = String(values.get("requestText") ?? "").trim();
    const budgetText = String(values.get("budget") ?? "").trim();
    const budgetMinor = budgetText ? toMinor(budgetText, service.currency) : null;
    if (requestText.length < 20 || (budgetText && !budgetMinor)) { setError("Describe the requested work in at least 20 characters and enter an exact optional budget."); return false; }
    try {
      await apiRequest(`/api/services/${service.id}/requests`, { method: "POST", body: { idempotencyKey, requestText, budgetMinor: budgetMinor ? Number(budgetMinor) : null } });
      setRequesting(null); setNotice("Hiring request sent. It does not create a project, agreement, invoice, or payment."); refresh();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be sent. You can retry with the same form."); }
    return false;
  };

  const respondRequest = async (request: ServiceRequest, decision: "accept" | "decline") => {
    try {
      await apiRequest(`/api/service-requests/${request.id}/respond`, { method: "POST", body: { decision } });
      setNotice(decision === "accept" ? "Service request accepted. Contract and project creation still require a separate hiring agreement." : "Service request declined."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The service request response could not be saved."); }
  };

  return <>
    <PageHeading eyebrow="FREELANCER SERVICES" title="Services marketplace" description="Browse opt-in service listings or shape a clear catalog offer with packages, delivery details, and portfolio references." action={user && isFreelancer ? <button className="button-primary" type="button" onClick={() => setDraft(blankDraft())}><Plus size={15} /> Create a service</button> : undefined} />
    {error && <p className="marketplace-alert" role="alert"><CircleAlert size={15} />{error}</p>}
    {notice && <p className="marketplace-notice" role="status"><Check size={15} />{notice}</p>}
    {user && isFreelancer && <section className="marketplace-service-owner profile-panel"><div className="marketplace-section-heading"><div><span className="eyebrow">YOUR CATALOG</span><h2>Manage services</h2><p>Publishing makes the service summary, packages, display name, and selected portfolio references available to anyone.</p></div><span>{myServices.length} saved</span></div>
      {myServices.length ? <div className="marketplace-own-services">{myServices.map((service) => <article className="marketplace-own-service" key={service.id}>
        <div><span className="marketplace-category">{service.category} · {service.isPublic ? "Public profile" : "Private listing"}</span><h3>{service.title}</h3><p>{service.description}</p><strong>{money(service.startingPriceMinor, service.currency)} · {service.deliveryDays} days</strong></div><StatusPill status={service.status} />
        <div className="marketplace-form-actions"><button type="button" className="button-secondary" onClick={() => setDraft(serviceDraft(service))}>Edit</button>{service.status === "published" ? <button type="button" className="button-secondary" onClick={() => void changeStatus(service, "unpublish")}>Unpublish</button> : service.status !== "archived" && <button type="button" className="button-primary" onClick={() => void changeStatus(service, "publish")}>Publish service <Eye size={13} /></button>}{service.status !== "archived" && <button type="button" className="marketplace-text-action" onClick={() => void changeStatus(service, "archive")}>Archive</button>}</div>
      </article>)}</div> : <div className="marketplace-empty-inline">No service listings yet. Create a draft when you are ready to describe a clear, scoped offer.</div>}
    </section>}

    {user && isClient && requests.some((item) => item.participantRole === "requester") && <section className="marketplace-proposal-box"><div className="marketplace-section-heading"><div><span className="eyebrow">HIRING REQUESTS</span><h2>Your requests</h2></div><span>{requests.filter((item) => item.participantRole === "requester" && item.status === "submitted").length} awaiting a response</span></div><div className="marketplace-service-requests">{requests.filter((item) => item.participantRole === "requester").map((item) => <RequestRow key={item.id} request={item} title={publicServices.find((service) => service.id === item.serviceId)?.title ?? "Freelancer service"} canRespond={false} onRespond={respondRequest} />)}</div></section>}
    {user && isFreelancer && requests.some((item) => item.participantRole === "provider") && <section className="marketplace-proposal-box"><div className="marketplace-section-heading"><div><span className="eyebrow">CLIENT INQUIRIES</span><h2>Service requests</h2></div><span>{requests.filter((item) => item.participantRole === "provider" && item.status === "submitted").length} awaiting your response</span></div><div className="marketplace-service-requests">{requests.filter((item) => item.participantRole === "provider").map((item) => <RequestRow key={item.id} request={item} title={myServices.find((service) => service.id === item.serviceId)?.title ?? "Freelancer service"} canRespond={item.status === "submitted"} onRespond={respondRequest} />)}</div></section>}

    <section className="marketplace-catalog-toolbar"><label className="marketplace-search"><span aria-hidden="true">⌕</span><input aria-label="Search services" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services, skills, or freelancers" /></label><select aria-label="Service category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All service categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><span><PackageOpen size={15} /> Public services are opt-in listings.</span></section>
    {loading ? <div className="marketplace-empty" role="status">Loading published services…</div> : filtered.length ? <div className="marketplace-service-grid">{filtered.map((service) => <article className="marketplace-service-card" key={service.id}>
      <div className="marketplace-service-card-head"><span className="marketplace-category">{service.category}</span><span className="marketplace-service-price">From {money(service.startingPriceMinor, service.currency)}</span></div>
      <h2>{service.title}</h2><p>{service.description}</p>
      <div className="marketplace-service-meta"><span><Clock3 size={14} /> {service.deliveryDays} day delivery</span><span>{service.packages.length} package{service.packages.length === 1 ? "" : "s"}</span></div>
      <ul>{service.deliverables.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
      <div className="marketplace-service-packages">{service.packages.map((item) => <article key={item.title}><strong>{item.title}</strong><span>{money(item.priceMinor, service.currency)} · {item.deliveryDays} days</span><small>{item.deliverables.slice(0, 3).join(" · ")}</small></article>)}</div>
      <footer><Link to={`/freelancers/${encodeURIComponent(service.freelancerSlug)}`}>{service.freelancerName} <ArrowUpRight size={13} /></Link>{user && isClient ? <button type="button" className="button-primary" onClick={() => setRequesting(service)}>Request this service <Send size={13} /></button> : !user ? <Link className="button-secondary" to="/signin">Sign in to request</Link> : <span className="marketplace-inline-note">Client account required to request.</span>}</footer>
    </article>)}</div> : <div className="marketplace-empty"><PackageOpen size={24} /><h2>{publicServices.length ? "No matching services" : "No published services yet"}</h2><p>{publicServices.length ? "Change the search or category filter." : "Freelancers can publish opt-in service listings from their catalog."}</p></div>}

    {draft && <ServiceEditor draft={draft} setDraft={setDraft} portfolio={portfolio} saving={saving} error={error} onCancel={() => setDraft(null)} onSave={saveService} />}
    {requesting && user && <ServiceRequestDialog service={requesting} onCancel={() => setRequesting(null)} onSubmit={requestService} />}
  </>;
}

function ServiceEditor({ draft, setDraft, portfolio, saving, error, onCancel, onSave }: {
  draft: Draft; setDraft: (draft: Draft | null) => void; portfolio: PortfolioRef[]; saving: boolean; error: string;
  onCancel: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const update = (field: keyof Draft, value: Draft[keyof Draft]) => setDraft({ ...draft, [field]: value } as Draft);
  const updatePackage = (index: number, patch: Partial<ServicePackage>) => update("packages", draft.packages.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="project-dialog marketplace-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="service-editor-title">
    <div className="dialog-heading"><div><span className="eyebrow">FREELANCER CATALOG</span><h2 id="service-editor-title">Shape a clear service.</h2></div><button className="dialog-close" type="button" onClick={onCancel} aria-label="Close editor"><X size={16} /></button></div>
    <p className="dialog-copy">Service pricing is saved in exact minor units. Public details are shown only after you publish a service and opt in.</p>
    <form className="marketplace-form" onSubmit={onSave}>
      <label>Service title<input required minLength={5} maxLength={140} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="Accessible product landing page" /></label>
      <label>Public URL slug<input required minLength={3} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={draft.slug || draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")} onChange={(event) => update("slug", event.target.value)} /></label>
      <label>Description<textarea required minLength={30} maxLength={5000} rows={4} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
      <div className="marketplace-form-grid"><label>Category<input required minLength={2} maxLength={80} value={draft.category} onChange={(event) => update("category", event.target.value)} placeholder="Design & product" /></label><label>Currency<input required maxLength={3} pattern="[A-Z]{3}" value={draft.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} /></label></div>
      <div className="marketplace-form-grid"><label>Starting price<input required inputMode="decimal" value={draft.startingPrice} onChange={(event) => update("startingPrice", event.target.value)} /></label><label>Delivery days<input required type="number" min="1" max="365" value={draft.deliveryDays} onChange={(event) => update("deliveryDays", event.target.value)} /></label></div>
      <label>Deliverables <span className="field-hint">One per line</span><textarea required rows={3} value={draft.deliverables} onChange={(event) => update("deliverables", event.target.value)} /></label>
      <div className="marketplace-package-editor-head"><div><strong>Packages</strong><small>Define what each price includes.</small></div>{draft.packages.length < 3 && <button type="button" className="button-secondary" onClick={() => update("packages", [...draft.packages, newPackage()])}><Plus size={13} /> Add package</button>}</div>
      {draft.packages.map((item, index) => <fieldset className="marketplace-package-fieldset" key={index}><legend>Package {index + 1}</legend>{draft.packages.length > 1 && <button type="button" className="marketplace-package-remove" aria-label={`Remove package ${index + 1}`} onClick={() => update("packages", draft.packages.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button>}<label>Package name<input required minLength={3} maxLength={80} value={item.title} onChange={(event) => updatePackage(index, { title: event.target.value })} placeholder="Standard" /></label><label>What is included?<textarea required minLength={5} maxLength={500} value={item.description} onChange={(event) => updatePackage(index, { description: event.target.value })} /></label><div className="marketplace-form-grid"><label>Price<input required inputMode="decimal" value={item.priceMinor} onChange={(event) => updatePackage(index, { priceMinor: event.target.value })} /></label><label>Delivery days<input required type="number" min="1" max="365" value={item.deliveryDays} onChange={(event) => updatePackage(index, { deliveryDays: Number(event.target.value) })} /></label></div><label>Package deliverables <span className="field-hint">One per line</span><textarea required rows={2} value={item.deliverables.join("\n")} onChange={(event) => updatePackage(index, { deliverables: lines(event.target.value) })} /></label></fieldset>)}
      {portfolio.length > 0 && <fieldset className="marketplace-reference-list"><legend>Portfolio examples</legend>{portfolio.map((item) => <label key={item.id}><input type="checkbox" checked={draft.portfolioItemIds.includes(item.id)} onChange={(event) => update("portfolioItemIds", event.target.checked ? [...new Set([...draft.portfolioItemIds, item.id])] : draft.portfolioItemIds.filter((id) => id !== item.id))} /> {item.title}</label>)}</fieldset>}
      <label className="profile-publish"><input type="checkbox" checked={draft.isPublic} onChange={(event) => update("isPublic", event.target.checked)} /><span><strong>Make this service eligible for public display</strong><small>The public catalog also requires freelancer profile visibility and a published service.</small></span></label>
      {error && <p className="marketplace-inline-error" role="alert">{error}</p>}
      <div className="marketplace-form-actions"><button className="button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? "Saving…" : "Save service"} <Check size={14} /></button></div>
    </form>
  </section></div>;
}

function ServiceRequestDialog({ service, onCancel, onSubmit }: { service: PublicService; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>, service: PublicService, key: string) => Promise<boolean> }) {
  const [key] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="service-request-title">
    <div className="dialog-heading"><div><span className="eyebrow">HIRING REQUEST</span><h2 id="service-request-title">Tell {service.freelancerName} what you need.</h2></div><button className="dialog-close" type="button" onClick={onCancel} aria-label="Close request"><X size={16} /></button></div>
    <p className="dialog-copy">{service.title} · from {money(service.startingPriceMinor, service.currency)}. This submits a request for discussion; it does not create an agreement or payment.</p>
    <form className="marketplace-form" onSubmit={(event) => { event.preventDefault(); setMessage(""); void onSubmit(event, service, key).then((saved) => { if (!saved) setMessage("The request was not saved. Review the details and try again; retry uses the same request key."); }); }}><label>Project details<textarea name="requestText" required minLength={20} maxLength={4000} rows={6} placeholder="Describe your goal, required deliverables, context, and any important dates." /></label><label>Optional budget ({service.currency})<input name="budget" inputMode="decimal" placeholder={fromMinor(service.startingPriceMinor, service.currency)} /></label>{message && <p role="alert" className="marketplace-inline-error">{message}</p>}<div className="marketplace-form-actions"><button type="button" className="button-secondary" onClick={onCancel}>Cancel</button><button className="button-primary">Send request <Send size={14} /></button></div></form>
  </section></div>;
}

function RequestRow({ request, title, canRespond, onRespond }: { request: ServiceRequest; title: string; canRespond: boolean; onRespond: (request: ServiceRequest, decision: "accept" | "decline") => void }) {
  return <article className="marketplace-request-row"><div><span className="marketplace-category">{title} · {new Date(request.createdAt).toLocaleDateString()}</span><StatusPill status={request.status} /><p>{request.requestText}</p>{request.budgetMinor && <strong>Proposed budget: {money(request.budgetMinor, request.currency)}</strong>}<small>Accepting this inquiry does not create a project or agreement.</small></div>{canRespond && <div className="marketplace-form-actions"><button className="button-secondary" type="button" onClick={() => onRespond(request, "decline")}>Decline</button><button className="button-primary" type="button" onClick={() => onRespond(request, "accept")}>Accept request <Check size={13} /></button></div>}</article>;
}
