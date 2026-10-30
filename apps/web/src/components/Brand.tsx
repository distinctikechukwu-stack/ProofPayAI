import { BadgeCheck } from "lucide-react";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`brand-lockup${inverse ? " brand-lockup-inverse" : ""}`}>
      <span className="brand-mark" aria-hidden="true"><BadgeCheck size={20} strokeWidth={2.2} /></span>
      <span className="brand-wordmark">ProofPay<span> AI</span></span>
    </span>
  );
}
