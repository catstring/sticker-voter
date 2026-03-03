"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isEmbeddedBrowser } from "@/lib/browser-auth";

export function AuthBar() {
  const { session, loading, signIn, signOut } = useAuth();
  const showEmbeddedBrowserWarning = useMemo(() => isEmbeddedBrowser(), []);

  return (
    <div className="card">
      <div className="row">
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
      {!session && showEmbeddedBrowserWarning ? (
        <div className="small" style={{ marginTop: 10 }}>
          If Google sign-in is blocked here, open this page in Safari/Chrome first, then sign in.
        </div>
      ) : null}
    </div>
  );
}
