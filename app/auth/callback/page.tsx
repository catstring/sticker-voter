"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const completeAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const next = params.get("next") || "/";

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        router.replace(next.startsWith("/") ? next : "/");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to complete sign-in.";
        setError(message);
      }
    };

    void completeAuth();
  }, [router]);

  return (
    <div className="stack">
      <div className="card">{error ? `Sign-in failed: ${error}` : "Completing sign-in..."}</div>
    </div>
  );
}
