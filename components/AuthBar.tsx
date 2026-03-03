"use client";

import { useAuth } from "@/components/AuthProvider";

export function AuthBar() {
  const { session, loading, signIn, signOut } = useAuth();

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
