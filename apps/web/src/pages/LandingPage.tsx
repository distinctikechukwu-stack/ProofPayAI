import {
  ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Check, ChevronRight, CircleDollarSign,
  FileCheck2, LockKeyhole, MessageSquareText, ShieldCheck, Sparkles, Waypoints,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";
import { acceptedScopeExcerpt, demoProject, formatMoney } from "../data/demo";

const valueProps = [
  { icon: FileCheck2, title: "Start with shared scope", copy: "Turn a project conversation into clear deliverables, milestones, and terms both sides can review." },
  { icon: Sparkles, title: "Catch scope changes early", copy: "Compare new requests with the accepted agreement and surface the source text for human review." },
  { icon: CircleDollarSign, title: "Invoice approved work", copy: "Keep milestone approval and PayPal invoicing connected, with payment status grounded in provider updates." },
];

export function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-nav wrap-wide">
        <Link to="/" aria-label="ProofPay AI home"><Brand /></Link>
        <nav aria-label="Primary"><a href="#how-it-works">How it works</a><a href="#scope-intelligence">Scope intelligence</a><a href="#security">Security</a></nav>
        <div className="landing-nav-actions"><Link className="nav-sign-in" to="/signin">Sign in</Link><Link className="button-primary nav-cta" to="/app">Open demo <ArrowUpRight size={15} /></Link></div>
      </header>

      <main>
        <section className="landing-hero wrap-wide">
          <div className="hero-copy">
            <span className="hero-kicker"><span className="kicker-dot" /> BUILT FOR INDEPENDENT WORK</span>
            <h1>Good work starts with <span>clear agreements.</span></h1>
            <p className="hero-subtitle">ProofPay AI brings project scope, milestone approvals, and PayPal invoicing into one calm, shared workspace.</p>
            <div className="hero-actions"><Link to="/app" className="button-primary button-large">Explore the demo <ArrowRight size={17} /></Link><a className="button-text" href="#how-it-works">See how it works <ArrowDown size={15} /></a></div>
            <div className="hero-trust"><span><Check size={14} /> Clear milestones</span><span><Check size={14} /> Human-approved changes</span><span><Check size={14} /> PayPal Sandbox</span></div>
          </div>

          <div className="hero-product" aria-label="Preview of a sample ProofPay project workspace">
            <div className="hero-glow" />
            <div className="preview-window">
              <div className="preview-topbar"><div className="preview-dots"><i /><i /><i /></div><span>proofpay.ai / project</span><span className="preview-secure"><LockKeyhole size={12} /> PRIVATE</span></div>
              <div className="preview-workspace">
                <aside className="preview-sidebar"><span className="preview-mini-logo"><BadgeCheck size={19} /></span><span className="preview-nav active"><Waypoints size={15} /></span><span className="preview-nav"><FileCheck2 size={15} /></span><span className="preview-nav"><CircleDollarSign size={15} /></span><span className="preview-avatar">OC</span></aside>
                <div className="preview-main">
                  <div className="preview-crumb">PROJECTS <ChevronRight size={11} /> WEBSITE REFRESH</div>
                  <div className="preview-heading"><div><h3>{demoProject.name}</h3><p>Northstar Studio <span>·</span> Due {demoProject.deadlineLabel}</p></div><span className="sample-tag"><span /> SAMPLE</span></div>
                  <div className="preview-progress"><div><span>PROJECT PROGRESS</span><strong>1 of 3 milestones approved</strong></div><div className="preview-progress-rail"><i /><i /><i /></div></div>
                  <div className="preview-milestones">
                    {demoProject.milestones.map((milestone, index) => (
                      <div className={`preview-milestone${index === 0 ? " preview-milestone-done" : ""}`} key={milestone.id}>
                        <span className="preview-step">{index === 0 ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span>
                        <span className="preview-milestone-name"><strong>{milestone.title}</strong><small>{index === 0 ? "Approved · ready for next step" : index === 1 ? "In progress" : "Up next"}</small></span>
                        <strong className="preview-amount">{formatMoney(milestone.amountCents)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="preview-insight"><span className="insight-icon"><Sparkles size={15} /></span><span><strong>A new request needs a closer look</strong><small>Review it against the accepted scope</small></span><ArrowUpRight size={14} /></div>
                </div>
              </div>
              <div className="preview-caption"><span className="caption-check"><Check size={13} /></span><span><strong>One shared record.</strong> The project preview uses clearly labeled sample data.</span></div>
            </div>
            <div className="hero-float hero-float-left"><span className="float-icon"><ShieldCheck size={16} /></span><span><strong>Scope stays visible</strong><small>From agreement to delivery</small></span></div>
            <div className="hero-float hero-float-right"><span className="float-dot" /><span><strong>Ready for review</strong><small>Approval stays with people</small></span></div>
          </div>
        </section>

        <section className="trust-strip"><div className="wrap-wide trust-strip-inner"><span>BUILT AROUND THE WAY FREELANCERS AND CLIENTS WORK</span><div><span><FileCheck2 size={15} /> Shared agreements</span><span><MessageSquareText size={15} /> Evidence-led reviews</span><span><CircleDollarSign size={15} /> PayPal Invoicing</span></div></div></section>

        <section className="landing-section wrap-wide" id="how-it-works">
          <div className="section-intro"><span className="eyebrow">LESS GUESSWORK. BETTER PROJECTS.</span><h2>A smoother path from <span>yes</span> to <span>paid.</span></h2><p>Everyone sees what was agreed, what changed, and what needs attention next.</p></div>
          <div className="value-grid">{valueProps.map(({ icon: Icon, title, copy }, index) => <article className="value-card" key={title}><span className="value-index">0{index + 1}</span><span className="value-icon"><Icon size={20} /></span><h3>{title}</h3><p>{copy}</p><span className="value-arrow"><ArrowUpRight size={16} /></span></article>)}</div>
        </section>

        <section className="scope-section" id="scope-intelligence"><div className="wrap-wide scope-section-inner"><div className="scope-copy"><span className="eyebrow">SCOPE INTELLIGENCE, WITH RECEIPTS</span><h2>Make the change clear before the work changes.</h2><p>When a request comes in, ProofPay compares it with the accepted agreement, points to the relevant wording, and helps both people decide what happens next.</p><Link to="/app/scope" className="button-secondary">Preview a scope review <ArrowRight size={16} /></Link><small>Sample analysis is illustrative. AI is not connected in this preview.</small></div><div className="scope-example"><div className="scope-example-head"><span className="example-sparkle"><Sparkles size={16} /></span><div><strong>Appointment booking</strong><small>Client request · sample project</small></div><span className="classification">OUTSIDE SCOPE</span></div><div className="scope-quote"><span>ACCEPTED AGREEMENT · SAMPLE TEXT</span><blockquote>“{acceptedScopeExcerpt}”</blockquote><span className="quote-source">Agreement version 1 · Scope of work</span></div><div className="scope-example-footer"><span><ShieldCheck size={15} /> Evidence stays attached</span><span>Review before deciding</span></div></div></div></section>

        <section className="safety-section wrap-wide" id="security"><div className="safety-heading"><span className="eyebrow">BUILT FOR TRUST</span><h2>People stay in control.</h2><p>ProofPay helps organize the work. It does not replace the agreement between the people doing it.</p></div><div className="safety-points"><div><span><FileCheck2 size={18} /></span><div><strong>Changes need agreement</strong><p>Accepted scope is versioned. Amendments do not take effect until both parties approve.</p></div></div><div><span><ShieldCheck size={18} /></span><div><strong>Payment status is verified</strong><p>PayPal payment updates come from verified provider events, not a button click.</p></div></div><div><span><LockKeyhole size={18} /></span><div><strong>Sandbox-first preview</strong><p>This demo uses sample data and makes no live payment or provider claim.</p></div></div></div></section>

        <section className="landing-cta"><div className="wrap-wide landing-cta-inner"><div><span className="eyebrow">A BETTER WAY TO WORK TOGETHER</span><h2>Bring the next project into focus.</h2><p>Explore the sample workspace and see how scope, approvals, and invoicing fit together.</p></div><Link className="button-primary button-large" to="/app">Open the sample workspace <ArrowRight size={17} /></Link></div></section>
      </main>

      <footer className="landing-footer wrap-wide"><Link to="/" aria-label="ProofPay AI home"><Brand /></Link><span>Clarity for independent work.</span><nav><a href="#how-it-works">How it works</a><Link to="/signin">Sign in</Link><span>© 2026 ProofPay AI</span></nav></footer>
    </div>
  );
}
