"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthBar } from "@/components/AuthBar";
import { OptionCard } from "@/components/OptionCard";
import { supabase } from "@/lib/supabase-browser";
import type { Poll, PollOptionResult } from "@/lib/types";

function isPollOpen(poll: Poll) {
  const now = new Date();
  const afterStart = !poll.starts_at || now >= new Date(poll.starts_at);
  const beforeEnd = !poll.ends_at || now < new Date(poll.ends_at);
  return poll.status === "open" && afterStart && beforeEnd;
}

function publicImage(path: string) {
  const { data } = supabase.storage.from("option-images").getPublicUrl(path);
  return data.publicUrl;
}

export default function PollPage() {
  const params = useParams<{ id: string }>();
  const pollId = params.id;

  const [session, setSession] = useState<Session | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [options, setOptions] = useState<PollOptionResult[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxVotes = poll?.max_votes_per_user ?? 8;
  const open = poll ? isPollOpen(poll) : false;

  const resultsByOption = useMemo(() => {
    const map = new Map<string, number>();
    for (const option of options) map.set(option.option_id, option.vote_count);
    return map;
  }, [options]);

  const loadSession = async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    return data.session;
  };

  const loadPoll = async (userId?: string) => {
    setError(null);

    const [{ data: pollData, error: pollError }, { data: optionData, error: optionError }] = await Promise.all([
      supabase
        .from("polls")
        .select("id,title,description,status,starts_at,ends_at,max_votes_per_user,created_by,created_at")
        .eq("id", pollId)
        .maybeSingle(),
      supabase
        .from("poll_option_results")
        .select("poll_id,option_id,title,image_path,display_order,vote_count")
        .eq("poll_id", pollId)
        .order("display_order", { ascending: true })
    ]);

    if (pollError) {
      setError(pollError.message);
      return;
    }
    if (optionError) {
      setError(optionError.message);
      return;
    }

    setPoll((pollData ?? null) as Poll | null);
    setOptions((optionData ?? []) as PollOptionResult[]);

    if (userId) {
      const { data: voteRows } = await supabase
        .from("votes")
        .select("option_id")
        .eq("poll_id", pollId)
        .eq("user_id", userId);

      setSelected((voteRows ?? []).map((row) => row.option_id));
    } else {
      setSelected([]);
    }
  };

  useEffect(() => {
    let alive = true;

    const init = async () => {
      const initialSession = await loadSession();
      if (!alive) return;
      await loadPoll(initialSession?.user.id);
    };

    void init();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_e, nextSession) => {
      setSession(nextSession);
      await loadPoll(nextSession?.user.id);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [pollId]);

  const toggle = (optionId: string) => {
    setMessage(null);
    setError(null);

    setSelected((prev) => {
      if (prev.includes(optionId)) return prev.filter((id) => id !== optionId);
      if (prev.length >= maxVotes) return prev;
      return [...prev, optionId];
    });
  };

  const saveVotes = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("set_poll_votes", {
      p_poll_id: pollId,
      p_option_ids: selected
    });

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    const savedCount = Array.isArray(data) && data[0]?.saved_votes ? data[0].saved_votes : selected.length;
    setMessage(`Saved ${savedCount} vote(s).`);

    await loadPoll(session?.user.id);
    setSaving(false);
  };

  return (
    <div className="stack">
      <AuthBar />
      <div className="row">
        <Link href="/">Back</Link>
        <Link href="/admin">Admin</Link>
      </div>

      {!poll ? <div className="card">Loading poll...</div> : null}
      {poll ? (
        <div className="card stack">
          <h1>{poll.title}</h1>
          {poll.description ? <div>{poll.description}</div> : null}
          <div className="small">
            Max picks: {poll.max_votes_per_user} | Status: {open ? "Open" : "Closed"}
          </div>
        </div>
      ) : null}

      {error ? <div className="card error">{error}</div> : null}
      {message ? <div className="card success">{message}</div> : null}

      <div className="card stack">
        <div className="row">
          <strong>
            Selected {selected.length}/{maxVotes}
          </strong>
          <button disabled={!session || !open || saving} onClick={saveVotes}>
            {saving ? "Saving..." : "Submit votes"}
          </button>
        </div>

        {!session ? <div className="small">Sign in with Google to submit votes.</div> : null}
        {!open ? <div className="small">Voting is currently closed for this poll.</div> : null}

        <div className="grid">
          {options.map((option) => {
            const checked = selected.includes(option.option_id);
            return (
              <OptionCard
                key={option.option_id}
                imageAlt={option.title ?? "Sticker option"}
                imageUrl={publicImage(option.image_path)}
                title={option.title ?? "Untitled"}
                hideTitle
                meta={`Votes: ${resultsByOption.get(option.option_id) ?? 0}`}
                className={`option--selectable ${checked ? "option--selected" : ""} ${!checked && selected.length >= maxVotes ? "option--disabled" : ""}`}
                onClick={() => {
                  if (!checked && selected.length >= maxVotes) return;
                  toggle(option.option_id);
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
