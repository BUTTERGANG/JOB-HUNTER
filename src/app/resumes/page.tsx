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
