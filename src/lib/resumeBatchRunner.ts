/**
 * Batch resume generation: work down the top of the ranked list.
 *
 * Two rules shape this:
 *
 * 1. **Check the arsenal before generating.** If a resume you already have covers the
 *    posting (match >= the reuse threshold), attach it instead of spending a model call.
 *    That is the entire point of the arsenal — without this check the batch would quietly
 *    rebuild the same resume ten times.
 *
 * 2. **A listing has to become a tracked job.** Tailoring, persistence and the DOCX export
 *    are all job-scoped, so each candidate is imported first. That is a real side effect —
 *    five jobs appear in the tracker and get a next step — but it is also the useful
 *    outcome: they land in the queue rather than sitting invisible in the scrape results.
 *
 * Runs in the background like the ranking backfill: start returns a run id, the UI polls.
 * The tailor step is performed by POSTing to this app's own /api/ai/tailor, so the batch
 * behaves identically to pressing the button — the prompt, the posting intel and the saved
 * metadata all come from one implementation.
 */

import {
  createJob,
  getResumeBatchCandidates,
  recommendResumeForJob,
  reuseResumeForJob,
  ensureNextStep,
} from "./db/queries";
import { RESUME_AUTO_REUSE_VERDICTS } from "./resumeMatch";

export interface ResumeBatchProgress {
  runId: string;
  status: "running" | "done" | "cancelled";
  total: number;
  done: number;
  tailored: number;
  reused: number;
  failed: number;
  /** What it is working on right now, for a live progress line. */
  current: string | null;
  minScore: number;
  errors: { company: string; role: string; error: string }[];
  results: { jobId: number; company: string; role: string; score: number; how: "reused" | "tailored" }[];
}

const registry = new Map<string, { cancelled: boolean }>();
const progress = new Map<string, ResumeBatchProgress>();

/**
 * The last completed run.
 *
 * Without this, the registry entry is deleted when the run ends and `getResumeBatchRun()`
 * returns null — so the results (and any errors) vanished the instant the batch finished
 * and the UI had nothing to show. The first real run completed in under 20 seconds and
 * looked like it had never happened.
 */
let lastFinished: ResumeBatchProgress | null = null;

/** Tailoring is a long model call; two in flight keeps it moving without hammering. */
const CONCURRENCY = 2;

export function getResumeBatchRun(): ResumeBatchProgress | null {
  const ids = [...registry.keys()];
  if (ids.length === 0) return lastFinished;
  return progress.get(ids[ids.length - 1]) ?? lastFinished;
}

export function cancelResumeBatch(runId?: string): boolean {
  const id = runId ?? [...registry.keys()][0];
  if (!id) return false;
  const entry = registry.get(id);
  if (!entry) return false;
  entry.cancelled = true;
  const p = progress.get(id);
  if (p) p.status = "cancelled";
  return true;
}

export function getResumeBatchProgress(runId: string): ResumeBatchProgress | null {
  return progress.get(runId) ?? null;
}

export function startResumeBatch(opts: {
  origin: string;
  minScore: number;
  limit: number;
}): { runId: string; total: number } | { error: string } {
  if (registry.size > 0) {
    return { error: "A resume batch is already running." };
  }

  const candidates = getResumeBatchCandidates(opts.minScore, opts.limit);
  if (candidates.length === 0) {
    return {
      error: `No untracked listings scoring ${opts.minScore}+ to work on. Scrape first, or lower the threshold.`,
    };
  }

  const runId = `resume_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  registry.set(runId, { cancelled: false });
  progress.set(runId, {
    runId,
    status: "running",
    total: candidates.length,
    done: 0,
    tailored: 0,
    reused: 0,
    failed: 0,
    current: null,
    minScore: opts.minScore,
    errors: [],
    results: [],
  });

  void run(runId, candidates, opts.origin);

  return { runId, total: candidates.length };
}

async function run(
  runId: string,
  candidates: ReturnType<typeof getResumeBatchCandidates>,
  origin: string
) {
  const entry = registry.get(runId)!;
  const state = progress.get(runId)!;
  let next = 0;

  async function worker() {
    while (true) {
      if (entry.cancelled) return;
      const index = next++;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      const label = `${candidate.company ?? "Unknown"} — ${candidate.role}`;
      state.current = label;

      try {
        // Import first: everything downstream is job-scoped.
        const job = createJob({
          company: candidate.company ?? "Unknown company",
          role: candidate.role ?? "Untitled role",
          location: candidate.location ?? null,
          url: candidate.url ?? null,
          source: candidate.source ?? null,
          salaryMin: candidate.salaryMin ?? null,
          salaryMax: candidate.salaryMax ?? null,
          description: candidate.description ?? null,
          status: "saved",
        });
        if (!job) throw new Error("Could not create the tracked job.");
        ensureNextStep(job.id);

        // Arsenal first — this is what stops the batch re-tailoring the same resume.
        const recommendation = recommendResumeForJob(job.id)?.recommendation;
        const best = recommendation?.best;
        if (best && RESUME_AUTO_REUSE_VERDICTS.includes(recommendation!.verdict)) {
          reuseResumeForJob(job.id, best.id);
          state.reused += 1;
          state.results.push({
            jobId: job.id,
            company: candidate.company ?? "Unknown company",
            role: candidate.role ?? "Untitled role",
            score: candidate.rankScore ?? 0,
            how: "reused",
          });
          continue;
        }

        if (!candidate.description || candidate.description.trim().length < 200) {
          // Tailoring needs the posting text. Recording the reason beats a silent skip.
          throw new Error("No usable job description on the listing — open the job to fetch it, then tailor.");
        }

        const res = await fetch(`${origin}/api/ai/tailor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, description: candidate.description }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Tailoring failed (HTTP ${res.status}).`);
        }

        state.tailored += 1;
        state.results.push({
          jobId: job.id,
          company: candidate.company ?? "Unknown company",
          role: candidate.role ?? "Untitled role",
          score: candidate.rankScore ?? 0,
          how: "tailored",
        });
      } catch (error) {
        state.failed += 1;
        state.errors.push({
          company: candidate.company ?? "Unknown company",
          role: candidate.role ?? "Untitled role",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        state.done += 1;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
  } finally {
    state.current = null;
    if (!entry.cancelled) state.status = "done";
    lastFinished = state; // kept after completion so the results remain readable
    registry.delete(runId);
  }
}
