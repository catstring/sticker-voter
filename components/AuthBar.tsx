"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";

export function AuthBar() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
      } catch {
        if (!mounted) return;
        setSession(null);
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

  const signIn = async () => {
    const redirectTo = window.location.href;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="card row">
      <div>
        <strong>Sticker Voter</strong>
        <div className="small">{session?.user?.email ?? (loading ? "Checking session..." : "Not signed in")}</div>
      </div>
      <div>
        {session ? (
          <button className="secondary" onClick={signOut}>
            Sign out
          </button>
        ) : (
          <button onClick={signIn}>Sign in with Google</button>
        )}
      </div>
    </div>
  );
}
