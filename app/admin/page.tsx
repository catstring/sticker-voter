"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AuthBar } from "@/components/AuthBar";
import { useAuth } from "@/components/AuthProvider";
import { OptionCard } from "@/components/OptionCard";
import { supabase } from "@/lib/supabase-browser";
import type { Poll, PollOptionResult } from "@/lib/types";

type PollForm = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  maxVotes: number;
  status: "draft" | "open" | "closed";
};

type PollStats = {
  optionCount: number;
  voteCount: number;
};

type StagedOption = {
  id: string;
  file: File;
  previewUrl: string;
  title: string;
};

function toTimestampInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromTimestampInput(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function defaultTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function publicImage(path: string) {
  const { data } = supabase.storage.from("option-images").getPublicUrl(path);
  return data.publicUrl;
}

export default function AdminPage() {
  const { session, loading: authLoading } = useAuth();
  const [isLoadingAdminState, setIsLoadingAdminState] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [pollStats, setPollStats] = useState<Record<string, PollStats>>({});
  const [selectedPollId, setSelectedPollId] = useState<string>("");
  const [selectedPollOptions, setSelectedPollOptions] = useState<PollOptionResult[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);

  const [isDragActive, setIsDragActive] = useState(false);
  const [stagedOptions, setStagedOptions] = useState<StagedOption[]>([]);
  const [isUploadingOptions, setIsUploadingOptions] = useState(false);

  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<PollForm | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stagedOptionsRef = useRef<StagedOption[]>([]);

  const [form, setForm] = useState<PollForm>({
    title: "",
    description: "",
    startsAt: "",
    endsAt: "",
    maxVotes: 8,
    status: "draft"
  });

  const selectedPoll = useMemo(() => polls.find((p) => p.id === selectedPollId), [polls, selectedPollId]);

  const revokeStagedPreviewUrls = (items: StagedOption[]) => {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
  };

  const clearStagedOptions = () => {
    setStagedOptions((prev) => {
      revokeStagedPreviewUrls(prev);
      return [];
    });
  };

  const loadPollStats = async (pollIds: string[]) => {
    if (pollIds.length === 0) {
      setPollStats({});
      return;
    }

    const [{ data: optionRows, error: optionError }, { data: voteRows, error: voteError }] = await Promise.all([
      supabase.from("poll_options").select("poll_id").in("poll_id", pollIds),
      supabase.from("votes").select("poll_id").in("poll_id", pollIds)
    ]);

    if (optionError) {
      setError(optionError.message);
      return;
    }
    if (voteError) {
      setError(voteError.message);
      return;
    }

    const next: Record<string, PollStats> = {};
    for (const pollId of pollIds) next[pollId] = { optionCount: 0, voteCount: 0 };

    for (const row of optionRows ?? []) {
      if (!next[row.poll_id]) next[row.poll_id] = { optionCount: 0, voteCount: 0 };
      next[row.poll_id].optionCount += 1;
    }

    for (const row of voteRows ?? []) {
      if (!next[row.poll_id]) next[row.poll_id] = { optionCount: 0, voteCount: 0 };
      next[row.poll_id].voteCount += 1;
    }

    setPollStats(next);
  };

  const loadAdminState = async () => {
    setIsLoadingAdminState(true);
    setError(null);
    try {
      if (!session?.user) {
        setIsAdmin(false);
        setPolls([]);
        setPollStats({});
        setSelectedPollId("");
        setSelectedPollOptions([]);
        return;
      }

      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (roleError) {
        setError(roleError.message);
        setIsAdmin(false);
        return;
      }

      const admin = roleData?.role === "admin";
      setIsAdmin(admin);

      if (!admin) {
        setPolls([]);
        setPollStats({});
        setSelectedPollId("");
        setSelectedPollOptions([]);
        return;
      }

      const { data: pollData, error: pollError } = await supabase
        .from("polls")
        .select("id,title,description,status,starts_at,ends_at,max_votes_per_user,created_by,created_at")
        .order("created_at", { ascending: false });

      if (pollError) {
        setError(pollError.message);
        return;
      }

      const list = (pollData ?? []) as Poll[];
      setPolls(list);

      if (!selectedPollId && list[0]) {
        setSelectedPollId(list[0].id);
      } else if (selectedPollId && !list.some((p) => p.id === selectedPollId)) {
        setSelectedPollId(list[0]?.id ?? "");
      }

      await loadPollStats(list.map((poll) => poll.id));
    } finally {
      setIsLoadingAdminState(false);
    }
  };

  const loadSelectedPollOptions = async (pollId: string) => {
    if (!pollId) {
      setSelectedPollOptions([]);
      setIsLoadingOptions(false);
      return;
    }

    setIsLoadingOptions(true);
    const { data, error: optionsError } = await supabase
      .from("poll_option_results")
      .select("poll_id,option_id,title,image_path,display_order,vote_count")
      .eq("poll_id", pollId)
      .order("display_order", { ascending: true });

    if (optionsError) {
      setError(optionsError.message);
      setIsLoadingOptions(false);
      return;
    }

    setSelectedPollOptions((data ?? []) as PollOptionResult[]);
    setIsLoadingOptions(false);
  };

  useEffect(() => {
    if (authLoading) return;
    void loadAdminState();
  }, [authLoading, session?.user?.id]);

  useEffect(() => {
    if (!isAdmin || !selectedPollId) {
      setSelectedPollOptions([]);
      return;
    }
    void loadSelectedPollOptions(selectedPollId);
  }, [isAdmin, selectedPollId]);

  useEffect(() => {
    stagedOptionsRef.current = stagedOptions;
  }, [stagedOptions]);

  useEffect(() => {
    return () => {
      revokeStagedPreviewUrls(stagedOptionsRef.current);
    };
  }, []);

  const createPoll = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!session?.user) {
      setError("Sign in first.");
      return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      starts_at: fromTimestampInput(form.startsAt),
      ends_at: fromTimestampInput(form.endsAt),
      max_votes_per_user: form.maxVotes,
      created_by: session.user.id
    };

    const { error: insertError } = await supabase.from("polls").insert(payload);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setForm({
      title: "",
      description: "",
      startsAt: "",
      endsAt: "",
      maxVotes: 8,
      status: "draft"
    });
    setMessage("Poll created.");
    await loadAdminState();
  };

  const startEditPoll = (poll: Poll) => {
    setEditingPollId(poll.id);
    setEditingForm({
      title: poll.title,
      description: poll.description ?? "",
      startsAt: toTimestampInput(poll.starts_at),
      endsAt: toTimestampInput(poll.ends_at),
      maxVotes: poll.max_votes_per_user,
      status: poll.status
    });
  };

  const savePollEdits = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingPollId || !editingForm) return;

    setMessage(null);
    setError(null);

    const { error: updateError } = await supabase
      .from("polls")
      .update({
        title: editingForm.title.trim(),
        description: editingForm.description.trim() || null,
        starts_at: fromTimestampInput(editingForm.startsAt),
        ends_at: fromTimestampInput(editingForm.endsAt),
        max_votes_per_user: editingForm.maxVotes,
        status: editingForm.status
      })
      .eq("id", editingPollId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Poll updated.");
    setEditingPollId(null);
    setEditingForm(null);
    await loadAdminState();
  };

  const deletePoll = async (pollId: string) => {
    const ok = window.confirm("Delete this poll and all its options/votes? This cannot be undone.");
    if (!ok) return;

    setMessage(null);
    setError(null);

    const { error: deleteError } = await supabase.from("polls").delete().eq("id", pollId);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (selectedPollId === pollId) {
      clearStagedOptions();
      setSelectedPollOptions([]);
      setSelectedPollId("");
    }

    setMessage("Poll deleted.");
    await loadAdminState();
  };

  const addFilesToQueue = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setError("Drop or select at least one image file.");
      return;
    }

    setError(null);

    const next = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      title: defaultTitleFromFileName(file.name)
    }));

    setStagedOptions((prev) => [...prev, ...next]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    addFilesToQueue(Array.from(event.dataTransfer.files ?? []));
  };

  const handlePickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    addFilesToQueue(Array.from(input.files ?? []));
    input.value = "";
  };

  const removeStagedOption = (id: string) => {
    setStagedOptions((prev) => {
      const item = prev.find((option) => option.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((option) => option.id !== id);
    });
  };

  const updateStagedTitle = (id: string, title: string) => {
    setStagedOptions((prev) => prev.map((option) => (option.id === id ? { ...option, title } : option)));
  };

  const confirmUploadStagedOptions = async () => {
    setMessage(null);
    setError(null);

    if (!selectedPollId) {
      setError("Select a poll first.");
      return;
    }

    if (stagedOptions.length === 0) {
      setError("No images in queue. Add files first.");
      return;
    }

    setIsUploadingOptions(true);

    try {
      const { data: maxRow, error: maxOrderError } = await supabase
        .from("poll_options")
        .select("display_order")
        .eq("poll_id", selectedPollId)
        .order("display_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxOrderError) throw new Error(maxOrderError.message);

      let nextDisplayOrder = (maxRow?.display_order ?? -1) + 1;
      let uploadedCount = 0;

      for (const staged of stagedOptions) {
        const safeName = staged.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const storageName = safeName || "image";
        const filePath = `${selectedPollId}/${Date.now()}-${crypto.randomUUID()}-${storageName}`;

        const { error: uploadError } = await supabase.storage.from("option-images").upload(filePath, staged.file, {
          upsert: false
        });

        if (uploadError) throw new Error(`${staged.file.name}: ${uploadError.message}`);

        const title = staged.title.trim() || defaultTitleFromFileName(staged.file.name) || null;
        const { error: insertError } = await supabase.from("poll_options").insert({
          poll_id: selectedPollId,
          title,
          image_path: filePath,
          display_order: nextDisplayOrder
        });

        if (insertError) throw new Error(`${staged.file.name}: ${insertError.message}`);

        uploadedCount += 1;
        nextDisplayOrder += 1;
      }

      clearStagedOptions();
      setMessage(`Uploaded ${uploadedCount} option(s).`);
      await Promise.all([loadSelectedPollOptions(selectedPollId), loadPollStats(polls.map((poll) => poll.id))]);
    } catch (uploadingError) {
      const uploadMessage = uploadingError instanceof Error ? uploadingError.message : "Failed to upload options.";
      setError(uploadMessage);
    } finally {
      setIsUploadingOptions(false);
      setIsDragActive(false);
    }
  };

  return (
    <div className="stack">
      <AuthBar />
      <div className="row">
        <h1>Admin</h1>
        <Link href="/">Back to polls</Link>
      </div>

      {error ? <div className="card error">{error}</div> : null}
      {message ? <div className="card success">{message}</div> : null}

      {authLoading || isLoadingAdminState ? <div className="card">Checking access...</div> : null}
      {!authLoading && !isLoadingAdminState && !session ? <div className="card">Sign in first.</div> : null}
      {!authLoading && !isLoadingAdminState && session && !isAdmin ? <div className="card">Your account is not admin.</div> : null}

      {!authLoading && !isLoadingAdminState && session && isAdmin ? (
        <>
          <form className="card stack" onSubmit={createPoll}>
            <h2>Create Poll</h2>
            <label>
              Title
              <input
                required
                value={form.title}
                onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="March Sticker Vote"
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
              />
            </label>
            <div className="grid">
              <label>
                Starts at
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => setForm((s) => ({ ...s, startsAt: e.target.value }))}
                />
              </label>
              <label>
                Ends at
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => setForm((s) => ({ ...s, endsAt: e.target.value }))}
                />
              </label>
              <label>
                Max votes per user
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.maxVotes}
                  onChange={(e) => setForm((s) => ({ ...s, maxVotes: Number(e.target.value) || 1 }))}
                />
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(e) => setForm((s) => ({ ...s, status: e.target.value as Poll["status"] }))}
                >
                  <option value="draft">draft</option>
                  <option value="open">open</option>
                  <option value="closed">closed</option>
                </select>
              </label>
            </div>
            <button>Create poll</button>
          </form>

          <div className="card stack">
            <h2>Manage Polls</h2>
            {polls.length === 0 ? <div className="small">No polls yet.</div> : null}
            {polls.map((poll) => {
              const stats = pollStats[poll.id] ?? { optionCount: 0, voteCount: 0 };
              const isEditing = editingPollId === poll.id && !!editingForm;

              return (
                <div className="card stack" key={poll.id}>
                  <div className="row">
                    <strong>{poll.title}</strong>
                    <div className="small">{poll.status}</div>
                  </div>
                  <div className="small">
                    Starts: {toTimestampInput(poll.starts_at) || "-"} | Ends: {toTimestampInput(poll.ends_at) || "-"} | Max: {poll.max_votes_per_user}
                  </div>
                  <div className="small">
                    Options: {stats.optionCount} | Total votes: {stats.voteCount}
                  </div>
                  <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-start" }}>
                    <button className="secondary" type="button" onClick={() => setSelectedPollId(poll.id)}>
                      Select for management
                    </button>
                    <button className="secondary" type="button" onClick={() => startEditPoll(poll)}>
                      Edit
                    </button>
                  </div>

                  {isEditing ? (
                    <form className="card stack" onSubmit={savePollEdits}>
                      <strong>Edit Poll</strong>
                      <label>
                        Title
                        <input
                          required
                          value={editingForm.title}
                          onChange={(e) => setEditingForm((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          rows={3}
                          value={editingForm.description}
                          onChange={(e) => setEditingForm((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                        />
                      </label>
                      <div className="grid">
                        <label>
                          Starts at
                          <input
                            type="datetime-local"
                            value={editingForm.startsAt}
                            onChange={(e) => setEditingForm((prev) => (prev ? { ...prev, startsAt: e.target.value } : prev))}
                          />
                        </label>
                        <label>
                          Ends at
                          <input
                            type="datetime-local"
                            value={editingForm.endsAt}
                            onChange={(e) => setEditingForm((prev) => (prev ? { ...prev, endsAt: e.target.value } : prev))}
                          />
                        </label>
                        <label>
                          Max votes per user
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={editingForm.maxVotes}
                            onChange={(e) =>
                              setEditingForm((prev) => (prev ? { ...prev, maxVotes: Number(e.target.value) || 1 } : prev))
                            }
                          />
                        </label>
                        <label>
                          Status
                          <select
                            value={editingForm.status}
                            onChange={(e) =>
                              setEditingForm((prev) => (prev ? { ...prev, status: e.target.value as Poll["status"] } : prev))
                            }
                          >
                            <option value="draft">draft</option>
                            <option value="open">open</option>
                            <option value="closed">closed</option>
                          </select>
                        </label>
                      </div>
                      <div className="row" style={{ justifyContent: "flex-start" }}>
                        <button type="submit">Save changes</button>
                        <button type="button" className="secondary" onClick={() => void deletePoll(poll.id)}>
                          Delete poll
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setEditingPollId(null);
                            setEditingForm(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="card stack">
            <h2>Poll Management</h2>
            <label>
              Target poll
              <select
                value={selectedPollId}
                onChange={(e) => {
                  clearStagedOptions();
                  setSelectedPollId(e.target.value);
                }}
              >
                <option value="">Select a poll</option>
                {polls.map((poll) => (
                  <option key={poll.id} value={poll.id}>
                    {poll.title}
                  </option>
                ))}
              </select>
            </label>
            {selectedPoll ? <div className="small">Selected: {selectedPoll.title}</div> : null}

            <div
              className={`dropzone ${isDragActive ? "dropzone--active" : ""}`}
              onDrop={handleDrop}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragActive(false);
              }}
            >
              <strong>Drag and drop multiple images to queue</strong>
              <div className="small">Images are not uploaded until you click Confirm upload.</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePickFiles}
                style={{ display: "none" }}
              />
              <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
                Browse images
              </button>
            </div>

            <div className="stack">
              <div className="row">
                <strong>Staged Upload Queue</strong>
                <span className="small">{stagedOptions.length} queued</span>
              </div>

              {stagedOptions.length === 0 ? <div className="small">No staged images yet.</div> : null}

              <div className="grid">
                {stagedOptions.map((staged) => (
                  <OptionCard
                    key={staged.id}
                    imageAlt={staged.title || "Staged option"}
                    imageUrl={staged.previewUrl}
                    title={staged.title || "Untitled"}
                  >
                    <label>
                      Option title
                      <input
                        value={staged.title}
                        onChange={(e) => updateStagedTitle(staged.id, e.target.value)}
                        placeholder="Option title"
                      />
                    </label>
                    <button type="button" className="secondary" onClick={() => removeStagedOption(staged.id)}>
                      Remove
                    </button>
                  </OptionCard>
                ))}
              </div>

              <div className="row" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={stagedOptions.length === 0 || isUploadingOptions}
                  onClick={() => {
                    const ok = window.confirm("Clear all staged images?");
                    if (ok) clearStagedOptions();
                  }}
                >
                  Clear queue
                </button>
                <button
                  type="button"
                  disabled={stagedOptions.length === 0 || isUploadingOptions || !selectedPollId}
                  onClick={confirmUploadStagedOptions}
                >
                  {isUploadingOptions ? "Uploading..." : "Confirm upload"}
                </button>
              </div>
            </div>

            <div className="stack">
              <div className="row">
                <strong>Current Options</strong>
                <span className="small">{selectedPollOptions.length} total</span>
              </div>
              {isLoadingOptions ? <div className="small">Loading options...</div> : null}
              {!isLoadingOptions && selectedPollOptions.length === 0 ? (
                <div className="small">No options yet for this poll.</div>
              ) : null}
              <div className="grid">
                {selectedPollOptions.map((option) => (
                  <OptionCard
                    key={option.option_id}
                    imageAlt={option.title ?? "Sticker option"}
                    imageUrl={publicImage(option.image_path)}
                    title={option.title ?? "Untitled"}
                    meta={`Order: ${option.display_order} | Votes: ${option.vote_count}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
