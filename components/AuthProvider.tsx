"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";
import { isEmbeddedBrowser } from "@/lib/browser-auth";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signIn: async () => {
        const next = `${window.location.pathname}${window.location.search}`;
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
        if (isEmbeddedBrowser()) {
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo, skipBrowserRedirect: true }
          });
          if (error) throw error;
          if (!data.url) throw new Error("Google sign-in URL was not returned.");

          // In embedded browsers, opening a new tab often escapes to Safari/Chrome.
          const opened = window.open(data.url, "_blank", "noopener,noreferrer");
          if (!opened) {
            window.location.assign(data.url);
          }
          return;
        }

        await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      },
      signOut: async () => {
        await supabase.auth.signOut();
      }
    }),
    [loading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
