import type { ReactNode } from "react";
import { ArrowRight, Check, Clock3, CircleAlert } from "lucide-react";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-heading-action">{action}</div>}</div>;
}

export function DemoNotice({ children }: { children: ReactNode }) {
  return <div className="demo-notice"><span className="demo-notice-icon"><CircleAlert size={16} /></span><p>{children}</p></div>;
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = ["approved", "paid"].includes(normalized) ? "success"
    : ["ready to invoice"].includes(normalized) ? "accent"
      : ["not started", "draft", "sandbox preview"].includes(normalized) ? "neutral"
        : ["not connected", "not configured", "unknown", "partially paid", "payment pending"].includes(normalized) ? "warning"
          : "progress";
  const Icon = ["approved", "paid"].includes(normalized) ? Check : ["ready to invoice", "awaiting review"].includes(normalized) ? Clock3 : null;
  return <span className={`status-pill status-${tone}`}>{Icon && <Icon size={12} />}{status}</span>;
}

export function SectionHeading({ title, subtitle, link }: { title: string; subtitle?: string; link?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{link && <div>{link}</div>}</div>;
}

export function TextAction({ children }: { children: ReactNode }) {
  return <span className="text-action">{children}<ArrowRight size={14} /></span>;
}
