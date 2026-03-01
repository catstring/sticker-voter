"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthBar } from "@/components/AuthBar";
import { supabase } from "@/lib/supabase-browser";
import type { Poll } from "@/lib/types";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function HomePage() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("polls")
        .select("id,title,description,status,starts_at,ends_at,max_votes_per_user,created_by,created_at")
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setPolls((data ?? []) as Poll[]);
      }
      setLoading(false);
    };

    void load();
  }, []);

  return (
    <div className="stack">
      <AuthBar />
      <div className="row">
        <h1>Open Polls</h1>
        <Link href="/admin">Admin</Link>
      </div>

      {loading ? <div className="card">Loading polls...</div> : null}
      {error ? <div className="card error">{error}</div> : null}

      {!loading && polls.length === 0 ? <div className="card">No open polls found.</div> : null}

      {polls.map((poll) => (
        <div className="card stack" key={poll.id}>
          <div className="row">
            <strong>{poll.title}</strong>
            <Link href={`/poll/${poll.id}`}>Vote</Link>
          </div>
          {poll.description ? <div>{poll.description}</div> : null}
          <div className="small">
            Max votes: {poll.max_votes_per_user} | Starts: {formatDate(poll.starts_at)} | Ends: {formatDate(poll.ends_at)}
          </div>
        </div>
      ))}
    </div>
  );
}
