import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { FreelancerProfileInput } from "@proofpay/shared";
import { ArrowLeft, ArrowUpRight, ExternalLink, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PageHeading } from "../components/WorkspacePrimitives";
import { useAuth } from "../contexts/AuthContext";
import { ApiError, apiRequest, publicApiRequest } from "../lib/api";

type PortfolioDraft = { title: string; description: string; projectUrl: string; imageUrl: string; featured: boolean };
type FreelancerDraft = {
  displayName: string; avatarUrl: string; publicSlug: string; headline: string; biography: string;
  skills: string; experienceSummary: string; educationSummary: string; languages: string; category: string;
  hourlyRate: string; currency: string; availability: "available" | "limited" | "unavailable"; isPublic: boolean;
  portfolio: PortfolioDraft[];
};
type ClientDraft = { accountType: "individual" | "business"; organizationName: string; organizationDescription: string; websiteUrl: string; billingEmail: string };
type ProfilePayload = {
  account: { display_name?: string; avatar_url?: string | null } | null;
  roles: string[];
  freelancer: null | Record<string, unknown>;
  portfolio: Array<Record<string, unknown>>;
  client: null | Record<string, unknown>;
};
type PublicProfile = {
  slug: string; displayName: string; avatarUrl: string | null; headline: string; biography: string;
  skills: string[]; experienceSummary: string; educationSummary: string; languages: string[]; category: string;
  hourlyRateMinor: string | null; currency: string; availability: "available" | "limited" | "unavailable";
  portfolio: PortfolioDraft[];
};

const blankPortfolio = (): PortfolioDraft => ({ title: "", description: "", projectUrl: "", imageUrl: "", featured: false });
const blankFreelancer = (): FreelancerDraft => ({
  displayName: "", avatarUrl: "", publicSlug: "", headline: "", biography: "", skills: "", experienceSummary: "",
  educationSummary: "", languages: "", category: "", hourlyRate: "", currency: "USD", availability: "available",
  isPublic: false, portfolio: [],
});
const blankClient = (): ClientDraft => ({ accountType: "individual", organizationName: "", organizationDescription: "", websiteUrl: "", billingEmail: "" });
const text = (value: unknown) => typeof value === "string" ? value : "";
const asList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
const profileSlug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

function currencyDigits(currency: string): number {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

function moneyToMinor(value: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const match = digits === 0 ? /^(\d+)$/.exec(value.trim()) : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(value.trim());
  if (!match?.[1]) return null;
  try {
    const minor = BigInt(match[1]) * (10n ** BigInt(digits)) + BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
    return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
  } catch { return null; }
}

function minorToInput(value: unknown, currency: string): string {
  if (value === null || value === undefined || !/^\d+$/.test(String(value))) return "";
  const digits = currencyDigits(currency);
  const amount = BigInt(String(value));
  const divisor = 10n ** BigInt(digits);
  const whole = (amount / divisor).toString();
  return digits ? `${whole}.${(amount % divisor).toString().padStart(digits, "0")}` : whole;
}

export function toFreelancerProfileRequestBody(draft: FreelancerDraft): FreelancerProfileInput {
  return {
    displayName: draft.displayName,
    avatarUrl: draft.avatarUrl || null,
    publicSlug: draft.publicSlug,
    headline: draft.headline,
    biography: draft.biography,
    skills: draft.skills.split(",").map((item) => item.trim()).filter(Boolean),
    experienceSummary: draft.experienceSummary,
    educationSummary: draft.educationSummary,
    languages: draft.languages.split(",").map((item) => item.trim()).filter(Boolean),
    category: draft.category,
    hourlyRateMinor: draft.hourlyRate.trim() ? moneyToMinor(draft.hourlyRate, draft.currency) : null,
    currency: draft.currency,
    availability: draft.availability,
    isPublic: draft.isPublic,
    portfolio: draft.portfolio.filter((item) => item.title.trim()).map((item) => ({
      ...item,
      projectUrl: item.projectUrl || null,
      imageUrl: item.imageUrl || null,
    })),
  };
}

function formatHourlyRate(minor: string, currency: string): string {
  const digits = currencyDigits(currency);
  const amount = BigInt(minor);
  const divisor = 10n ** BigInt(digits);
  const whole = amount / divisor;
  const fraction = digits ? `.${(amount % divisor).toString().padStart(digits, "0")}` : "";
  try { return `${new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(whole)}${fraction} / hour`; }
  catch { return `${currency} ${whole.toString()}${fraction} / hour`; }
}

export function ProfilePage() {
  const { user, configured } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [roleChoices, setRoleChoices] = useState<Array<"freelancer" | "client">>([]);
  const [account, setAccount] = useState({ displayName: "", avatarUrl: "" });
  const [freelancer, setFreelancer] = useState<FreelancerDraft>(blankFreelancer());
  const [client, setClient] = useState<ClientDraft>(blankClient());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const hasFreelancerRole = roles.includes("freelancer");
  const hasClientRole = roles.includes("client");
  const profileCompleteness = useMemo(() => {
    const fields = [
      Boolean(freelancer.displayName.trim()), Boolean(freelancer.avatarUrl.trim()), Boolean(freelancer.headline.trim()),
      Boolean(freelancer.biography.trim()), Boolean(freelancer.skills.trim()), Boolean(freelancer.experienceSummary.trim()),
      Boolean(freelancer.educationSummary.trim()), Boolean(freelancer.languages.trim()), Boolean(freelancer.category.trim()),
      Boolean(freelancer.hourlyRate.trim()), freelancer.portfolio.some((item) => item.title.trim()),
    ];
    return Math.round(fields.filter(Boolean).length * 100 / fields.length);
  }, [freelancer]);

  useEffect(() => {
    if (!user) { setLoaded(true); return; }
    let active = true;
    void apiRequest<ProfilePayload>("/api/profile").then((data) => {
      if (!active) return;
      const displayName = text(data.account?.display_name) || text(user.user_metadata?.display_name);
      const avatarUrl = text(data.account?.avatar_url);
      setAccount({ displayName, avatarUrl });
      const savedRoles = data.roles.filter((role) => ["freelancer", "client", "admin"].includes(role));
      setRoles(savedRoles);
      setRoleChoices(savedRoles.filter((role): role is "freelancer" | "client" => role === "freelancer" || role === "client"));
      const fp = data.freelancer;
      const currency = text(fp?.currency) || "USD";
      setFreelancer({
        displayName, avatarUrl,
        publicSlug: text(fp?.public_slug) || profileSlug(displayName),
        headline: text(fp?.headline), biography: text(fp?.biography), skills: asList(fp?.skills),
        experienceSummary: text(fp?.experience_summary), educationSummary: text(fp?.education_summary),
        languages: asList(fp?.languages), category: text(fp?.category), hourlyRate: minorToInput(fp?.hourly_rate_minor, currency),
        currency, availability: fp?.availability === "limited" || fp?.availability === "unavailable" ? fp.availability : "available",
        isPublic: fp?.is_public === true,
        portfolio: data.portfolio.map((item) => ({
          title: text(item.title), description: text(item.description), projectUrl: text(item.project_url),
          imageUrl: text(item.image_url), featured: item.featured === true,
        })),
      });
      const cp = data.client;
      setClient({
        accountType: cp?.account_type === "business" ? "business" : "individual",
        organizationName: text(cp?.organization_name), organizationDescription: text(cp?.organization_description),
        websiteUrl: text(cp?.website_url), billingEmail: text(cp?.billing_email),
      });
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Profile details could not be loaded.");
      setLoaded(true);
    });
    return () => { active = false; };
  }, [user]);

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("account"); setError(""); setNotice("");
    try {
      await apiRequest("/api/profile/account", { method: "POST", body: { displayName: account.displayName, avatarUrl: account.avatarUrl || null } });
      setFreelancer((current) => ({ ...current, displayName: account.displayName, avatarUrl: account.avatarUrl }));
      setNotice("Account display details saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Account details could not be saved."); }
    finally { setBusy(""); }
  };

  const saveRoles = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("roles"); setError(""); setNotice("");
    try {
      const response = await apiRequest<{ roles: string[] }>("/api/profile/roles", { method: "POST", body: { roles: roleChoices } });
      setRoles(response.roles);
      setRoleChoices(response.roles.filter((role): role is "freelancer" | "client" => role === "freelancer" || role === "client"));
      setNotice("Marketplace roles saved to your account.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Roles could not be saved."); }
    finally { setBusy(""); }
  };

  const saveFreelancer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("freelancer"); setError(""); setNotice("");
    const body = toFreelancerProfileRequestBody(freelancer);
    if (freelancer.hourlyRate.trim() && body.hourlyRateMinor === null) {
      setBusy(""); setError("Enter a positive hourly rate using the fraction digits supported by this currency."); return;
    }
    try {
      await apiRequest("/api/profile/freelancer", {
        method: "POST",
        body,
      });
      setNotice(freelancer.isPublic ? "Freelancer profile saved and published." : "Freelancer profile saved as private.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Freelancer profile could not be saved."); }
    finally { setBusy(""); }
  };

  const saveClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("client"); setError(""); setNotice("");
    try {
      await apiRequest("/api/profile/client", { method: "POST", body: { ...client, websiteUrl: client.websiteUrl || null, billingEmail: client.billingEmail || null } });
      setNotice("Private client profile saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Client profile could not be saved."); }
    finally { setBusy(""); }
  };

  const toggleRole = (role: "freelancer" | "client", checked: boolean) => setRoleChoices((current) => checked
    ? [...new Set([...current, role])]
    : current.filter((item) => item !== role));

  if (!user) return <>
    <PageHeading eyebrow="YOUR MARKETPLACE IDENTITY" title="Profile & roles" description="Edit your freelancer or client identity and decide what may appear publicly." />
    <div className="profile-empty"><ShieldCheck size={24} /><h2>Sign in to manage your profile</h2><p>The sample workspace does not save account, role, or profile data.</p><Link className="button-primary" to="/signin">Sign in <ArrowUpRight size={15} /></Link></div>
  </>;

  if (!configured || !loaded) return <>
    <PageHeading eyebrow="YOUR MARKETPLACE IDENTITY" title="Profile & roles" description="Edit your freelancer or client identity and decide what may appear publicly." />
    <div className="profile-empty" role="status"><ShieldCheck size={24} /><h2>{!configured ? "Supabase is not configured" : "Loading your profile…"}</h2><p>{!configured ? "Profile editing is unavailable until Supabase Auth and the API are configured." : "Loading private profile records."}</p></div>
  </>;

  return <>
    <PageHeading eyebrow="YOUR MARKETPLACE IDENTITY" title="Profile & roles" description="Choose how you work on ProofPay AI. Private account details stay out of public profile responses." />
    <div className="profile-feedback" aria-live="polite">{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>

    <section className="surface-card profile-panel">
      <div className="profile-panel-heading"><div><span className="eyebrow">ACCOUNT</span><h2>Display details</h2><p>Your email and billing settings are not part of public freelancer profiles.</p></div><ShieldCheck size={19} /></div>
      <form className="profile-form" onSubmit={saveAccount}>
        <label>Display name<input required minLength={2} maxLength={80} value={account.displayName} onChange={(event) => setAccount({ ...account, displayName: event.target.value })} /></label>
        <label>Avatar image URL <span className="field-hint">Optional · HTTPS only</span><input type="url" placeholder="https://…" value={account.avatarUrl} onChange={(event) => setAccount({ ...account, avatarUrl: event.target.value })} /></label>
        <button className="button-primary" type="submit" disabled={busy !== ""}>{busy === "account" ? "Saving…" : "Save account details"} <Save size={14} /></button>
      </form>
    </section>

    <section className="surface-card profile-panel">
      <div className="profile-panel-heading"><div><span className="eyebrow">ACCOUNT ROLES</span><h2>Choose your marketplace roles</h2><p>You can work as a freelancer, a client, or both. Administrator access is granted separately by a trusted operator.</p></div><ShieldCheck size={19} /></div>
      <form className="profile-role-form" onSubmit={saveRoles}>
        <label><input type="checkbox" checked={roleChoices.includes("freelancer")} onChange={(event) => toggleRole("freelancer", event.target.checked)} /> <span><strong>Freelancer</strong><small>Showcase skills and portfolio work, then respond to opportunities.</small></span></label>
        <label><input type="checkbox" checked={roleChoices.includes("client")} onChange={(event) => toggleRole("client", event.target.checked)} /> <span><strong>Client</strong><small>Describe your organization and manage hiring work.</small></span></label>
        {roles.includes("admin") && <span className="profile-admin-badge">Administrator · assigned by operator</span>}
        <button className="button-secondary" type="submit" disabled={busy !== "" || roleChoices.length === 0}>{busy === "roles" ? "Saving…" : "Save roles"}</button>
      </form>
    </section>

    {hasFreelancerRole ? <section className="surface-card profile-panel">
      <div className="profile-panel-heading"><div><span className="eyebrow">FREELANCER PROFILE</span><h2>Tell clients what you do</h2><p>Only fields in this form and published portfolio entries appear on your public profile.</p></div><ExternalLink size={18} /></div>
      <div className="profile-completeness"><div><strong>Profile completeness</strong><span>{profileCompleteness}%</span></div><progress value={profileCompleteness} max={100} aria-label={`Profile completeness ${profileCompleteness}%`} /><small>This is a checklist of profile fields, not a qualification or identity verification.</small></div>
      {freelancer.isPublic && freelancer.publicSlug && <p className="profile-public-link"><span>Public URL</span><Link to={`/freelancers/${encodeURIComponent(freelancer.publicSlug)}`} target="_blank">/freelancers/{freelancer.publicSlug} <ArrowUpRight size={13} /></Link></p>}
      <form className="profile-form" onSubmit={saveFreelancer}>
        <div className="profile-field-grid">
          <label>Public profile URL slug<input required minLength={3} maxLength={48} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={freelancer.publicSlug} onChange={(event) => setFreelancer({ ...freelancer, publicSlug: event.target.value.toLowerCase() })} /></label>
          <label>Professional headline<input maxLength={120} placeholder="Product designer for thoughtful digital services" value={freelancer.headline} onChange={(event) => setFreelancer({ ...freelancer, headline: event.target.value })} /></label>
        </div>
        <label>About you<textarea rows={5} maxLength={2400} value={freelancer.biography} onChange={(event) => setFreelancer({ ...freelancer, biography: event.target.value })} /></label>
        <div className="profile-field-grid">
          <label>Skills <span className="field-hint">Comma separated · up to 20</span><input placeholder="Product design, Figma, research" value={freelancer.skills} onChange={(event) => setFreelancer({ ...freelancer, skills: event.target.value })} /></label>
          <label>Languages <span className="field-hint">Comma separated</span><input placeholder="English, Yoruba" value={freelancer.languages} onChange={(event) => setFreelancer({ ...freelancer, languages: event.target.value })} /></label>
          <label>Category<input maxLength={80} placeholder="Design & creative" value={freelancer.category} onChange={(event) => setFreelancer({ ...freelancer, category: event.target.value })} /></label>
          <label>Availability<select value={freelancer.availability} onChange={(event) => setFreelancer({ ...freelancer, availability: event.target.value as FreelancerDraft["availability"] })}><option value="available">Available</option><option value="limited">Limited availability</option><option value="unavailable">Unavailable</option></select></label>
          <label>Experience summary<textarea rows={3} maxLength={1800} value={freelancer.experienceSummary} onChange={(event) => setFreelancer({ ...freelancer, experienceSummary: event.target.value })} /></label>
          <label>Education summary<textarea rows={3} maxLength={1200} value={freelancer.educationSummary} onChange={(event) => setFreelancer({ ...freelancer, educationSummary: event.target.value })} /></label>
          <label>Hourly preference<input inputMode="decimal" placeholder="75.00" value={freelancer.hourlyRate} onChange={(event) => setFreelancer({ ...freelancer, hourlyRate: event.target.value })} /><span className="field-hint">Amount is stored in exact {freelancer.currency} minor units.</span></label>
          <label>Rate currency<input required maxLength={3} pattern="[A-Z]{3}" value={freelancer.currency} onChange={(event) => setFreelancer({ ...freelancer, currency: event.target.value.toUpperCase() })} /></label>
        </div>
        <div className="profile-portfolio-head"><div><h3>Portfolio</h3><p>Link work you are allowed to share. Do not add client-confidential materials.</p></div><button className="button-secondary" type="button" disabled={freelancer.portfolio.length >= 12} onClick={() => setFreelancer({ ...freelancer, portfolio: [...freelancer.portfolio, blankPortfolio()] })}><Plus size={14} /> Add item</button></div>
        {freelancer.portfolio.map((item, index) => <fieldset className="profile-portfolio-item" key={`${index}-${item.title}`}><legend>Portfolio item {index + 1}</legend><button type="button" className="profile-remove" aria-label={`Remove portfolio item ${index + 1}`} onClick={() => setFreelancer({ ...freelancer, portfolio: freelancer.portfolio.filter((_, row) => row !== index) })}><Trash2 size={14} /></button><label>Title<input maxLength={120} value={item.title} onChange={(event) => setFreelancer({ ...freelancer, portfolio: freelancer.portfolio.map((entry, row) => row === index ? { ...entry, title: event.target.value } : entry) })} /></label><label>Description<textarea rows={2} maxLength={1000} value={item.description} onChange={(event) => setFreelancer({ ...freelancer, portfolio: freelancer.portfolio.map((entry, row) => row === index ? { ...entry, description: event.target.value } : entry) })} /></label><div className="profile-field-grid"><label>Project link<input type="url" placeholder="https://…" value={item.projectUrl} onChange={(event) => setFreelancer({ ...freelancer, portfolio: freelancer.portfolio.map((entry, row) => row === index ? { ...entry, projectUrl: event.target.value } : entry) })} /></label><label>Preview image URL<input type="url" placeholder="https://…" value={item.imageUrl} onChange={(event) => setFreelancer({ ...freelancer, portfolio: freelancer.portfolio.map((entry, row) => row === index ? { ...entry, imageUrl: event.target.value } : entry) })} /></label></div><label className="profile-inline-check"><input type="checkbox" checked={item.featured} onChange={(event) => setFreelancer({ ...freelancer, portfolio: freelancer.portfolio.map((entry, row) => row === index ? { ...entry, featured: event.target.checked } : entry) })} /> Feature this work</label></fieldset>)}
        <label className="profile-publish"><input type="checkbox" checked={freelancer.isPublic} onChange={(event) => setFreelancer({ ...freelancer, isPublic: event.target.checked })} /><span><strong>Publish my freelancer profile</strong><small>Anyone with its URL can view the public fields and portfolio. Email, billing details, account roles, and project records stay private.</small></span></label>
        <button className="button-primary" type="submit" disabled={busy !== ""}>{busy === "freelancer" ? "Saving profile…" : "Save freelancer profile"} <Save size={14} /></button>
      </form>
    </section> : <section className="profile-role-hint"><strong>Freelancer profile not active</strong><span>Choose the freelancer role above to create and publish a public profile.</span></section>}

    {hasClientRole ? <section className="surface-card profile-panel">
      <div className="profile-panel-heading"><div><span className="eyebrow">CLIENT PROFILE</span><h2>Organization details</h2><p>This profile and billing contact are private to your account for now.</p></div><ShieldCheck size={19} /></div>
      <form className="profile-form" onSubmit={saveClient}>
        <label>Account type<select value={client.accountType} onChange={(event) => setClient({ ...client, accountType: event.target.value as ClientDraft["accountType"] })}><option value="individual">Individual</option><option value="business">Business</option></select></label>
        <label>Organization name<input maxLength={160} value={client.organizationName} onChange={(event) => setClient({ ...client, organizationName: event.target.value })} /></label>
        <label>Organization description<textarea rows={4} maxLength={1800} value={client.organizationDescription} onChange={(event) => setClient({ ...client, organizationDescription: event.target.value })} /></label>
        <div className="profile-field-grid"><label>Website<input type="url" placeholder="https://…" value={client.websiteUrl} onChange={(event) => setClient({ ...client, websiteUrl: event.target.value })} /></label><label>Billing email <span className="field-hint">Private · never included in public profile output</span><input type="email" value={client.billingEmail} onChange={(event) => setClient({ ...client, billingEmail: event.target.value })} /></label></div>
        <button className="button-primary" type="submit" disabled={busy !== ""}>{busy === "client" ? "Saving profile…" : "Save client profile"} <Save size={14} /></button>
      </form>
    </section> : <section className="profile-role-hint"><strong>Client profile not active</strong><span>Choose the client role above to add private organization and billing preferences.</span></section>}
  </>;
}

export function PublicFreelancerPage() {
  const { slug = "" } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [message, setMessage] = useState("Loading public profile…");
  const validSlug = useMemo(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 48, [slug]);
  useEffect(() => {
    if (!validSlug) { setMessage("This public profile is unavailable."); return; }
    let active = true;
    void publicApiRequest<{ profile: PublicProfile }>(`/api/public/freelancers/${encodeURIComponent(slug)}`).then((response) => {
      if (!active) return;
      setProfile(response.profile); setMessage("");
    }).catch((reason: unknown) => {
      if (!active) return;
      setMessage(reason instanceof ApiError && reason.status === 404 ? "This public profile is unavailable or private." : reason instanceof Error ? reason.message : "This public profile could not be loaded.");
    });
    return () => { active = false; };
  }, [slug, validSlug]);

  if (!profile) return <main className="public-profile-page"><Link to="/" className="profile-back"><ArrowLeft size={15} /> ProofPay AI</Link><section className="public-profile-empty"><span className="eyebrow">FREELANCER PROFILE</span><h1>{message}</h1><p>Public profiles are available only when a freelancer chooses to publish them.</p><Link to="/" className="button-secondary">Back to ProofPay AI</Link></section></main>;
  return <main className="public-profile-page">
    <Link to="/" className="profile-back"><ArrowLeft size={15} /> ProofPay AI</Link>
    <section className="public-profile-card">
      <div className="public-profile-hero"><span className="public-profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" /> : profile.displayName.slice(0, 1).toUpperCase()}</span><div><span className="eyebrow">{profile.category || "INDEPENDENT PROFESSIONAL"}</span><h1>{profile.displayName}</h1>{profile.headline && <p>{profile.headline}</p>}<span className={`public-availability availability-${profile.availability}`}>{profile.availability === "available" ? "Available for work" : profile.availability === "limited" ? "Limited availability" : "Not taking new work"}</span></div>{profile.hourlyRateMinor && <strong className="public-profile-rate">{formatHourlyRate(profile.hourlyRateMinor, profile.currency)}</strong>}</div>
      {profile.biography && <section className="public-profile-section"><h2>About</h2><p>{profile.biography}</p></section>}
      {profile.skills.length > 0 && <section className="public-profile-section"><h2>Skills</h2><div className="public-skill-list">{profile.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></section>}
      {(profile.experienceSummary || profile.educationSummary || profile.languages.length > 0) && <section className="public-profile-section"><h2>Experience & background</h2>{profile.experienceSummary && <p>{profile.experienceSummary}</p>}{profile.educationSummary && <p>{profile.educationSummary}</p>}{profile.languages.length > 0 && <p><strong>Languages:</strong> {profile.languages.join(", ")}</p>}</section>}
      {profile.portfolio.length > 0 && <section className="public-profile-section"><h2>Selected work</h2><div className="public-portfolio-grid">{profile.portfolio.map((item, index) => <article className="public-portfolio-card" key={`${item.title}-${index}`}>{item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}{item.featured && <span className="eyebrow">FEATURED WORK</span>}<h3>{item.title}</h3>{item.description && <p>{item.description}</p>}{item.projectUrl && <a href={item.projectUrl} target="_blank" rel="noreferrer">View project <ExternalLink size={13} /></a>}</article>)}</div></section>}
    </section>
    <footer className="public-profile-footer">ProofPay AI · Public profile fields are provided by the profile owner.</footer>
  </main>;
}
