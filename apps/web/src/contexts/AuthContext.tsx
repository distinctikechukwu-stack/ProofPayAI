import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const configured = Boolean(url && anonKey && !url.startsWith("your-") && !anonKey.startsWith("your-"));

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  passwordRecovery: boolean;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signUp(name: string, email: string, password: string): Promise<{ error: string | null; needsEmailVerification: boolean }>;
  signOut(): Promise<{ error: string | null }>;
  sendRecovery(email: string): Promise<{ error: string | null }>;
  updatePassword(password: string): Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | undefined;
    void import("../lib/supabase").then(({ supabase }) => {
      if (!active || !supabase) return;
      setClient(supabase);
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setPasswordRecovery(event === "PASSWORD_RECOVERY");
      });
      unsubscribe = () => subscription.unsubscribe();
      void supabase.auth.getSession().then(({ data }) => {
        if (active) {
          setSession(data.session);
          setLoading(false);
        }
      }).catch(() => {
        if (active) setLoading(false);
      });
    }).catch(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured,
    loading,
    session,
    user: session?.user ?? null,
    passwordRecovery,
    async signIn(email, password) {
      if (!client) return { error: configured ? "Supabase Auth is still initializing." : "Supabase Auth is not configured." };
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    async signUp(name, email, password) {
      if (!client) return { error: configured ? "Supabase Auth is still initializing." : "Supabase Auth is not configured.", needsEmailVerification: false };
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/app`,
        },
      });
      return { error: error?.message ?? null, needsEmailVerification: !error && !data.session };
    },
    async signOut() {
      if (!client) return { error: null };
      const { error } = await client.auth.signOut();
      return { error: error?.message ?? null };
    },
    async sendRecovery(email) {
      if (!client) return { error: configured ? "Supabase Auth is still initializing." : "Supabase Auth is not configured." };
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/recover` });
      return { error: error?.message ?? null };
    },
    async updatePassword(password) {
      if (!client) return { error: configured ? "Supabase Auth is still initializing." : "Supabase Auth is not configured." };
      const { error } = await client.auth.updateUser({ password });
      if (!error) setPasswordRecovery(false);
      return { error: error?.message ?? null };
    },
  }), [client, loading, passwordRecovery, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
