import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { useAuth } from "../contexts/AuthContext";

export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const { configured, loading: authLoading, signIn, signInWithGoogle, signUp } = useAuth();
  const isSignUp = mode === "signup";

  const submitAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configured || busy) return;
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    setBusy(true);
    setMessage("");
    try {
      if (isSignUp) {
        const result = await signUp(String(values.get("name") ?? ""), email, password);
        if (result.error) setMessage(result.error);
        else if (result.needsEmailVerification) setMessage("Check your inbox to verify your email before signing in.");
        else navigate("/app");
      } else {
        const result = await signIn(email, password);
        if (result.error) setMessage(result.error);
        else navigate("/app");
      }
    } catch {
      setMessage("Authentication is temporarily unavailable. Try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    if (!configured || busy || authLoading) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        setMessage(result.error);
        setBusy(false);
      }
      // Supabase Auth redirects through /auth/callback and restores its session there.
    } catch {
      setMessage("Google sign-in could not be started. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-story"><Link to="/" className="auth-logo"><Brand inverse /></Link><div className="auth-story-body"><span className="eyebrow">BETTER WORK, CLEARER TERMS</span><h1>Let the good work speak for itself.</h1><p>Keep the agreement, milestones, and payment steps together so everyone knows where things stand.</p><div className="auth-testimonial"><span className="auth-quote-mark">“</span><p>Clear scope makes the best client relationships even better.</p><span>ProofPay AI · Product principle</span></div></div><div className="auth-story-foot"><LockKeyhole size={14} /> Secure project workflows, built for independent work</div></section>
      <section className="auth-form-side"><div className="auth-topline"><Link to="/" className="auth-back"><ArrowLeft size={15} /> Back to home</Link><span>Already exploring? <Link to="/app">Open demo</Link></span></div><div className="auth-form-wrap"><span className="auth-form-tag"><span /> {configured ? "SECURE ACCOUNT ACCESS" : "AUTHENTICATION NOT CONFIGURED"}</span><h2>{isSignUp ? "Create your account" : "Welcome back"}</h2><p className="auth-subtitle">{isSignUp ? "Set up your workspace to bring your projects together." : "Sign in to pick up where your project left off."}</p>{!configured && <div className="auth-preview-note"><strong>Supabase Auth is not configured</strong><span>Account forms are unavailable. Continue to the clearly labeled sample workspace without submitting credentials.</span></div>}
        {configured && <>
          <button className="button-secondary auth-google-button" type="button" onClick={() => void continueWithGoogle()} disabled={busy || authLoading}>
            <span className="auth-google-mark" aria-hidden="true">G</span>{busy ? "Connecting to Google…" : "Continue with Google"}
          </button>
          <div className="auth-divider"><span /> <small>OR CONTINUE WITH EMAIL</small> <span /></div>
        </>}
        <form className="auth-form" onSubmit={submitAccount}>
          {isSignUp && <label>Full name<input name="name" autoComplete="name" placeholder="Your name" minLength={2} required disabled={!configured} /></label>}
          <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={!configured} /></label>
          {!isSignUp && <Link className="forgot-link" to="/recover">Forgot password?</Link>}
          <label>Password<span className="password-input"><input name="password" type={showPassword ? "text" : "password"} autoComplete={isSignUp ? "new-password" : "current-password"} placeholder="At least 8 characters" minLength={8} required disabled={!configured} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)} disabled={!configured}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          {message && <p role="status" className="auth-message">{message}</p>}
          {configured && <button className="button-primary auth-submit" type="submit" disabled={busy || authLoading}>{busy || authLoading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"} <ArrowRight size={16} /></button>}
        </form>
        {!configured && <><div className="auth-divider"><span /> <small>OR</small> <span /></div>
        <button className="button-secondary auth-sample-button" type="button" onClick={() => navigate("/app")}><Check size={15} /> Continue without an account</button></>}
        <p className="auth-switch">{isSignUp ? "Already have an account?" : "New to ProofPay AI?"} <Link to={isSignUp ? "/signin" : "/signup"}>{isSignUp ? "Sign in" : "Create an account"}</Link></p>
        <p className="auth-legal">By continuing, you agree to ProofPay AI’s account terms. AI-generated agreement language should be reviewed and is not legal advice.</p></div>
      </section>
    </main>
  );
}

export function RecoveryPage() {
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { configured, passwordRecovery, sendRecovery, updatePassword } = useAuth();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configured || busy) return;

    const values = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      if (passwordRecovery) {
        const result = await updatePassword(String(values.get('password') ?? ''));
        if (result.error) setMessage(result.error);
        else {
          setSubmitted(true);
          setMessage('Your password was updated.');
        }
      } else {
        const result = await sendRecovery(String(values.get('email') ?? ''));
        if (result.error) setMessage(result.error);
        else {
          setSubmitted(true);
          setMessage('If the address is registered, a secure recovery link will arrive shortly.');
        }
      }
    } catch {
      setMessage('Account recovery is temporarily unavailable. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="recovery-page">
      <Link to="/" className="auth-logo"><Brand /></Link>
      <section className="recovery-card">
        <span className="recovery-icon"><LockKeyhole size={20} /></span>
        <span className="eyebrow">{configured ? 'ACCOUNT RECOVERY' : 'ACCOUNT RECOVERY PREVIEW'}</span>
        <h1>{passwordRecovery ? 'Choose a new password.' : 'Reset your password.'}</h1>
        <p>{configured
          ? passwordRecovery
            ? 'Set a new password for your ProofPay AI account.'
            : 'We’ll send a secure recovery link if the address can receive one.'
          : 'Supabase Auth is not configured, so no recovery email can be sent.'}</p>
        {submitted ? (
          <div className="auth-preview-note">
            <strong>{configured ? 'Request received' : 'Not connected'}</strong>
            <span>{message}</span>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            {passwordRecovery ? (
              <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} required disabled={!configured || busy} /></label>
            ) : (
              <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={!configured || busy} /></label>
            )}
            {configured ? (
              <button className="button-primary auth-submit" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : passwordRecovery ? 'Update password' : 'Send recovery link'} <ArrowRight size={16} />
              </button>
            ) : (
              <Link to="/app" className="button-secondary auth-sample-button">Continue to sample workspace</Link>
            )}
            {message && <p role="status" className="auth-message">{message}</p>}
          </form>
        )}
        <Link to="/signin" className="auth-back recovery-back"><ArrowLeft size={15} /> Back to sign in</Link>
      </section>
    </main>
  );
}
