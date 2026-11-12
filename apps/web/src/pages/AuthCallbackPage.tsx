import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { useAuth } from "../contexts/AuthContext";

function hasProviderError(search: string, fragment: string): boolean {
  const query = new URLSearchParams(search);
  const hash = new URLSearchParams(fragment.replace(/^#/, ""));
  return [query, hash].some((params) =>
    ["error", "error_code", "error_description"].some((key) => params.has(key)),
  );
}

export function AuthCallbackPage() {
  const { configured, loading, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const providerError = hasProviderError(location.search, location.hash);

  useEffect(() => {
    if (!loading && session) navigate("/app/profile", { replace: true });
  }, [loading, navigate, session]);

  if (loading || session) {
    return <main className="recovery-page"><Link to="/" className="auth-logo"><Brand /></Link><section className="recovery-card"><p role="status">Finishing secure sign-in…</p></section></main>;
  }

  return <main className="recovery-page"><Link to="/" className="auth-logo"><Brand /></Link><section className="recovery-card">
    <span className="eyebrow">ACCOUNT SIGN-IN</span>
    <h1>{configured ? "Sign-in could not be completed." : "Sign-in is not configured."}</h1>
    <p role="alert">{providerError
      ? "Google did not complete the sign-in. Return to the sign-in page and try again."
      : configured
        ? "No active ProofPay AI session was established. Return to sign-in and try again."
        : "Google sign-in is unavailable until Supabase Auth is configured."}</p>
    <Link to="/signin" className="button-primary auth-submit">Return to sign in</Link>
  </section></main>;
}
