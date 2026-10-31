"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface ArsenalResume {
  id: number;
  jobId: number | null;
  type: string;
  label: string;
  roleTitle: string | null;
  keywords: string[];
  sourceResumeId: number | null;
  reuseCount: number | null;
  createdAt: string;
  chars: number;
  company: string | null;
  jobRole: string | null;
}

interface BatchRun {
  runId: string;
  status: "running" | "done" | "cancelled";
  total: number;
  done: number;
  tailored: number;
  reused: number;
  failed: number;
  current: string | null;
  minScore: number;
  errors: { company: string; role: string; error: string }[];
  results: { jobId: number; company: string; role: string; score: number; how: "reused" | "tailored" }[];
}

interface TrackedJob {
  id: number;
  company: string;
  role: string;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  master: { label: "Master", className: "bg-gray-100 text-gray-700" },
  tailored: { label: "Tailored", className: "bg-blue-100 text-blue-800" },
  reused: { label: "Reused", className: "bg-green-100 text-green-800" },
};

function relative(iso: string): string {
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(then.getTime())) return "—";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * The resume arsenal.
 *
 * Every resume the app has produced, so a similar posting can reuse one instead of being
 * tailored from scratch. The matching itself lives on the job page — this is the library
 * view: what you have, what it was built for, and which ones actually get reused.
 */
export default function ResumesPage() {
  const [resumes, setResumes] = useState<ArsenalResume[]>([]);
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [reuseTarget, setReuseTarget] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState("");
  const [batch, setBatch] = useState<BatchRun | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchScore, setBatchScore] = useState(70);
  const [batchLimit, setBatchLimit] = useState(5);

  function load() {
    Promise.all([
      fetch("/api/resumes").then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
    ])
      .then(([r, j]) => {
        setResumes(r.resumes ?? []);
        setJobs(Array.isArray(j) ? j : (j.jobs ?? []));
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load the arsenal.");
        setLoading(false);
      });
  }

  useEffect(load, []);

  // Poll the batch while it runs; the runner lives server-side and keeps going if you
  // navigate away, so the state comes back on reload too.
  useEffect(() => {
    fetch("/api/resumes/batch")
      .then((r) => r.json())
      .then((d) => setBatch(d.run ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (batch?.status !== "running") return;
    const timer = setTimeout(() => {
      fetch("/api/resumes/batch")
        .then((r) => r.json())
        .then((d) => {
          setBatch(d.run ?? null);
          if (d.run?.status !== "running") load();
        })
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, [batch, ]);

  async function startBatch() {
    setBatchBusy(true);
    setBatchError("");
    try {
      const res = await fetch("/api/resumes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minScore: batchScore, limit: batchLimit }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBatchError(json.error ?? "Could not start the batch.");
        return;
      }
      const status = await fetch("/api/resumes/batch").then((r) => r.json());
      setBatch(status.run ?? null);
    } catch {
      setBatchError("Network error — nothing started.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function act(id: number, fn: () => Promise<Response>, message: string) {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const res = await fn();
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "That did not work.");
        return false;
      }
      setNotice(message);
      load();
      return true;
    } catch {
      setError("Network error.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const master = resumes.filter((r) => r.type === "master");
  const tailored = resumes.filter((r) => r.type === "tailored");
  const reused = resumes.filter((r) => r.type === "reused");

  return (
    <div className="space-y-7">
      <div className="rounded-2xl border border-border bg-card px-5 py-6 sm:px-7 sm:py-7">
        <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-primary">
          Arsenal
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Resumes</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every resume the app has produced. When a job comes up, the job page checks this
          library first and recommends one you already have — tailoring a fresh one is for
          postings that genuinely differ. Resumes get here when you tailor them; a reused
          one is a copy, so the original keeps its reuse count.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-primary">{notice}</p>}

      {/* ── Batch generation ── */}
      <Card>
        <CardContent className="pt-4">
          {batch?.status === "running" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  Generating for the top matches… ({batch.done} / {batch.total})
                </span>
                <button
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                  onClick={() =>
                    fetch("/api/resumes/batch", { method: "DELETE" })
                      .then((r) => r.json())
                      .then(() => fetch("/api/resumes/batch").then((r) => r.json()))
                      .then((d) => setBatch(d.run ?? null))
                      .catch(() => {})
                  }
                >
                  Cancel
                </button>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((batch.done / Math.max(1, batch.total)) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {batch.reused} reused · {batch.tailored} tailored · {batch.failed} failed
                {batch.current ? ` · now: ${batch.current}` : ""}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Generate for top matches</p>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  Walks the highest-scoring listings that are not tracked yet. It checks this
                  library first and reuses a resume that already fits, so only genuinely
                  different postings cost a model call. Each one is added to your tracker with
                  a next step.
                </p>
                {/* In this branch the status is already known not to be "running". */}
                {batch && batch.total > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last run: {batch.reused} reused · {batch.tailored} tailored · {batch.failed} failed
                    {batch.errors.length > 0 && ` — ${batch.errors[0].error}`}
                  </p>
                )}
                {batchError && <p className="mt-1 text-xs text-destructive">{batchError}</p>}
              </div>
              <div className="flex items-end gap-2">
                <label className="text-xs text-muted-foreground">
                  min score
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={batchScore}
                    onChange={(e) => setBatchScore(Number(e.target.value))}
                    className="mt-1 block h-8 w-16 rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  how many
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={batchLimit}
                    onChange={(e) => setBatchLimit(Number(e.target.value))}
                    className="mt-1 block h-8 w-16 rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <Button size="sm" disabled={batchBusy} onClick={startBatch}>
                  {batchBusy ? "Starting…" : "Start"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : resumes.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-muted-foreground">
              No resumes yet. Tailor one from a job and it will appear here.
            </p>
            <Link href="/jobs">
              <Button size="sm" variant="outline">
                Go to Jobs
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline" className="py-1 px-3">{master.length} master</Badge>
            <Badge variant="outline" className="py-1 px-3">{tailored.length} tailored</Badge>
            <Badge variant="outline" className="py-1 px-3">{reused.length} reused</Badge>
            <Badge variant="outline" className="py-1 px-3">
              {resumes.reduce((sum, r) => sum + (r.reuseCount ?? 0), 0)} total reuses
            </Badge>
          </div>

          <div className="space-y-3">
            {resumes.map((resume) => {
              const badge = TYPE_BADGE[resume.type] ?? { label: resume.type, className: "" };
              const isRenaming = renaming === resume.id;
              return (
                <Card key={resume.id}>
                  <CardContent className="pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <div className="flex gap-2">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              autoFocus
                              className="h-8 max-w-md"
                            />
                            <Button
                              size="sm"
                              disabled={busy === resume.id}
                              onClick={async () => {
                                const ok = await act(
                                  resume.id,
                                  () =>
                                    fetch(`/api/resumes/${resume.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ label: renameValue }),
                                    }),
                                  "Renamed."
                                );
                                if (ok) setRenaming(null);
                              }}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold">{resume.label}</span>
                            <Badge variant="outline" className={`text-xs ${badge.className}`}>
                              {badge.label}
                            </Badge>
                            {(resume.reuseCount ?? 0) > 0 && (
                              <Badge variant="outline" className="text-xs text-primary border-primary/30">
                                reused {resume.reuseCount}×
                              </Badge>
                            )}
                          </div>
                        )}

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{relative(resume.createdAt)}</span>
                          <span>{(resume.chars / 1024).toFixed(1)} KB</span>
                          {resume.jobId && (
                            <Link href={`/jobs/${resume.jobId}`} className="hover:underline">
                              from {resume.jobRole} @ {resume.company}
                            </Link>
                          )}
                          {resume.sourceResumeId && <span>copy of #{resume.sourceResumeId}</span>}
                        </div>

                        {resume.keywords.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {resume.keywords.slice(0, 8).map((k) => (
                              <span
                                key={k}
                                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                              >
                                {k}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-stretch gap-2 sm:min-w-[190px]">
                        <a href={`/api/resumes/${resume.id}/docx`}>
                          <Button size="sm" variant="outline" className="w-full">
                            Download .docx
                          </Button>
                        </a>

                        {jobs.length > 0 && (
                          <div className="flex gap-1">
                            <select
                              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                              value={reuseTarget[resume.id] ?? ""}
                              onChange={(e) =>
                                setReuseTarget((prev) => ({ ...prev, [resume.id]: e.target.value }))
                              }
                            >
                              <option value="">Use for…</option>
                              {jobs.map((job) => (
                                <option key={job.id} value={job.id}>
                                  {job.role} — {job.company}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              disabled={!reuseTarget[resume.id] || busy === resume.id}
                              onClick={() =>
                                act(
                                  resume.id,
                                  () =>
                                    fetch(`/api/resumes/${resume.id}`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ jobId: Number(reuseTarget[resume.id]) }),
                                    }),
                                  "Reused — the job now has this resume."
                                )
                              }
                            >
                              Use
                            </Button>
                          </div>
                        )}

                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="flex-1 text-xs"
                            onClick={() => {
                              setRenaming(resume.id);
                              setRenameValue(resume.label);
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="flex-1 text-xs text-muted-foreground"
                            disabled={busy === resume.id}
                            onClick={() => {
                              if (!window.confirm(`Delete "${resume.label}"? This cannot be undone.`)) return;
                              act(
                                resume.id,
                                () => fetch(`/api/resumes/${resume.id}`, { method: "DELETE" }),
                                "Deleted."
                              );
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
