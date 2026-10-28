/**
 * Pipeline progression: how far a listing actually got, what to do next, and the
 * metrics that fall out of that over time.
 *
 * Why this is a separate module with no database imports: the interesting parts are
 * the rules (stage ordering, "furthest reached", next-step choice, conversion rates),
 * and those need to be assertable without a live DB or an API key. Everything here is
 * a pure function over plain rows; the queries module only fetches and persists.
 *
 * The central idea: `jobs.status` holds only the CURRENT status, so on its own it
 * cannot answer "how far did I get?". A rejection after an onsite and a rejection the
 * day after applying are the same value. `job_stage_events` records every transition,
 * so progress is reconstructed from history rather than read off the current row.
 */

import { FOLLOW_UP_DAYS } from "./constants";

/** The ordered stages that represent progress. Terminal outcomes are not stages. */
export const PIPELINE_STAGES = [
  "saved",
  "applied",
  "phone_screen",
  "technical",
  "onsite",
  "offer",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Outcomes that end a pipeline. They are results, not progress. */
export const TERMINAL_OUTCOMES = ["rejected", "ghosted", "withdrew"] as const;

/** Stages that count as "a human responded". */
export const RESPONSE_STAGES: readonly string[] = ["phone_screen", "technical", "onsite", "offer"];

const STAGE_LABELS: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  phone_screen: "Phone screen",
  technical: "Technical",
  onsite: "Onsite",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  withdrew: "Withdrew",
};

export function stageLabel(status: string): string {
  return STAGE_LABELS[status] ?? status;
}

/**
 * Position in the pipeline, or null when the value is not a stage (terminal outcomes
 * and unknown strings). `offer` is the last stage, so it is the maximum.
 */
export function stageOrdinal(status: string | null | undefined): number | null {
  if (!status) return null;
  const index = (PIPELINE_STAGES as readonly string[]).indexOf(status);
  return index === -1 ? null : index;
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_OUTCOMES as readonly string[]).includes(status);
}

export function isResponseStage(status: string | null | undefined): boolean {
  return !!status && RESPONSE_STAGES.includes(status);
}

/**
 * Parse the timestamp formats this database actually contains.
 *
 * `date_applied` and friends are plain `YYYY-MM-DD`; `created_at`/`occurred_at` default
 * to SQLite's `datetime('now')`, which is `YYYY-MM-DD HH:MM:SS` **in UTC**. Feeding the
 * space form to `new Date()` parses it as local time, which silently shifts day counts
 * by one for evening timestamps — so normalise to an explicit UTC ISO string first.
 */
export function parseTs(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function daysBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** The furthest stage a listing ever reached, ignoring terminal outcomes. */
export function furthestReached(statuses: readonly string[]): {
  stage: PipelineStage;
  ordinal: number;
} {
  let best: { stage: PipelineStage; ordinal: number } = { stage: "saved", ordinal: 0 };
  for (const status of statuses) {
    const ordinal = stageOrdinal(status);
    if (ordinal !== null && ordinal > best.ordinal) {
      best = { stage: status as PipelineStage, ordinal };
    }
  }
  return best;
}

export interface NextStepSuggestion {
  label: string;
  detail: string;
  dueDate: string | null;
}

/** Add `days` to a date, as `YYYY-MM-DD`. */
function addDays(date: Date, days: number): string {
  const next = new Date(date.getTime() + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/**
 * What to do next, given where the listing is.
 *
 * Deterministic on purpose: the point of the step list is that you never have to
 * decide what to do, so the app decides. Terminal outcomes produce nothing — a closed
 * pipeline should leave the queue alone rather than nag.
 */
export function proposeNextStep(
  input: { status: string; dateApplied?: string | null; followUpDate?: string | null },
  now: Date = new Date()
): NextStepSuggestion | null {
  const applied = parseTs(input.dateApplied);

  switch (input.status) {
    case "saved":
      return {
        label: "Apply",
        detail: "Send the application, then mark this done — the clock on follow-ups starts here.",
        dueDate: now.toISOString().slice(0, 10),
      };
    case "applied": {
      const followUp = parseTs(input.followUpDate) ?? (applied ? new Date(applied.getTime() + FOLLOW_UP_DAYS * 86_400_000) : null);
      // Compare at day granularity, not instants. Measuring from `now` (which carries a
      // time of day) against a midnight due date reported a 10-day window as "in 9 days".
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const overdue = followUp ? followUp.getTime() <= today.getTime() : false;
      return {
        label: overdue ? "Follow up" : `Follow up in ${Math.max(0, daysBetween(today, followUp) ?? 0)} days`,
        detail: overdue
          ? "Past your follow-up window — a short nudge to the recruiter or hiring manager."
          : `Nothing to do until then. Due ${followUp ? followUp.toISOString().slice(0, 10) : "—"}.`,
        dueDate: followUp ? followUp.toISOString().slice(0, 10) : null,
      };
    }
    case "phone_screen":
      return {
        label: "Send thank-you note",
        detail: "Same day while it is fresh, and confirm what the next round looks like.",
        dueDate: addDays(now, 1),
      };
    case "technical":
      return {
        label: "Send thank-you note",
        detail: "Reference something specific from the conversation; ask about timeline.",
        dueDate: addDays(now, 1),
      };
    case "onsite":
      return {
        label: "Send thank-you + ask for timeline",
        detail: "Thank each interviewer, then ask when they expect to decide.",
        dueDate: addDays(now, 1),
      };
    case "offer":
      return {
        label: "Respond to the offer",
        detail: "Ask for it in writing, then decide or negotiate against your target number.",
        dueDate: addDays(now, 2),
      };
    default:
      // rejected / ghosted / withdrew / anything unknown: nothing to chase.
      return null;
  }
}

export interface JobProgressInput {
  id: number;
  company: string;
  role: string;
  status: string;
  dateApplied?: string | null;
  followUpDate?: string | null;
}

export interface StageEventInput {
  jobId: number;
  fromStatus?: string | null;
  toStatus: string;
  occurredAt: string;
}

export interface JobProgress {
  jobId: number;
  company: string;
  role: string;
  currentStatus: string;
  /** Furthest stage ever reached, which is the real measure of how far you got. */
  furthestStage: string;
  furthestOrdinal: number;
  /** Terminal outcome if the pipeline closed. */
  outcome: string | null;
  appliedAt: string | null;
  daysSinceApplied: number | null;
  /** Days from applying to the first human response, null if none yet. */
  daysToFirstResponse: number | null;
  daysInCurrentStatus: number | null;
  reachedResponse: boolean;
  reachedInterview: boolean;
  reachedOffer: boolean;
}

/** Interview = anything past the phone screen, i.e. a real conversation happened. */
const INTERVIEW_STAGES: readonly string[] = ["technical", "onsite", "offer"];

export function computeJobProgress(
  job: JobProgressInput,
  events: readonly StageEventInput[],
  now: Date = new Date()
): JobProgress {
  const mine = events
    .filter((e) => e.jobId === job.id)
    .slice()
    .sort((a, b) => (parseTs(a.occurredAt)?.getTime() ?? 0) - (parseTs(b.occurredAt)?.getTime() ?? 0));

  // Reconstruct the whole path: every recorded transition plus the current status.
  // The current status is included because a job can be created directly at any stage
  // (imported as 'applied', say) with no earlier event to derive it from.
  const path = [...mine.map((e) => e.toStatus), job.status];
  const { stage: furthestStage, ordinal: furthestOrdinal } = furthestReached(path);

  // Applying can predate any event if the job was imported with a date_applied.
  const appliedAt =
    mine.find((e) => e.toStatus === "applied")?.occurredAt ?? job.dateApplied ?? null;
  const appliedDate = parseTs(appliedAt);

  // First response = the first transition into a stage that means a human replied.
  const firstResponse = mine.find((e) => isResponseStage(e.toStatus));
  let daysToFirstResponse = daysBetween(appliedDate, parseTs(firstResponse?.occurredAt) ?? now);
  if (!firstResponse) daysToFirstResponse = null;

  // How long the current status has held — from its own transition if we have one.
  const currentEvent = [...mine].reverse().find((e) => e.toStatus === job.status);
  const daysInCurrentStatus = daysBetween(parseTs(currentEvent?.occurredAt) ?? appliedDate, now);

  const reachedResponse = path.some(isResponseStage);
  const reachedInterview = path.some((s) => INTERVIEW_STAGES.includes(s));
  const reachedOffer = path.includes("offer");

  return {
    jobId: job.id,
    company: job.company,
    role: job.role,
    currentStatus: job.status,
    furthestStage,
    furthestOrdinal,
    outcome: isTerminalStatus(job.status) ? job.status : null,
    appliedAt: appliedAt ?? null,
    daysSinceApplied: daysBetween(appliedDate, now),
    daysToFirstResponse,
    daysInCurrentStatus,
    reachedResponse,
    reachedInterview,
    reachedOffer,
  };
}

export interface PipelineCohort {
  /** ISO week, e.g. 2026-W43. */
  week: string;
  applied: number;
  responded: number;
  interviewed: number;
  offered: number;
}

export interface PipelineMetrics {
  total: number;
  byStatus: Record<string, number>;
  /** Jobs that were actually applied to (status left 'saved', or an applied event exists). */
  applied: number;
  responded: number;
  interviewed: number;
  offered: number;
  /** Conversion rates over APPLIED jobs. Null when there is nothing to divide by. */
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  medianDaysToFirstResponse: number | null;
  /** Distribution of how far each listing got — the "how far did I make it" view. */
  furthestBreakdown: { stage: string; label: string; count: number }[];
  /** Applications grouped by the week they went out, so the trend is visible. */
  cohorts: PipelineCohort[];
  progress: JobProgress[];
}

/** ISO-8601 week key, e.g. 2026-W43. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Aggregate the whole pipeline.
 *
 * Rates are computed over APPLIED jobs, not over everything tracked, because a saved
 * listing you never applied to cannot fail to respond — counting it would just dilute
 * the numbers and make the funnel look worse than it is.
 */
export function computePipelineMetrics(
  jobs: readonly JobProgressInput[],
  events: readonly StageEventInput[],
  now: Date = new Date()
): PipelineMetrics {
  const progress = jobs.map((job) => computeJobProgress(job, events, now));

  const byStatus: Record<string, number> = {};
  for (const job of jobs) byStatus[job.status] = (byStatus[job.status] || 0) + 1;

  const appliedJobs = progress.filter((p) => p.appliedAt !== null || p.furthestOrdinal >= 1);
  const responded = appliedJobs.filter((p) => p.reachedResponse).length;
  const interviewed = appliedJobs.filter((p) => p.reachedInterview).length;
  const offered = appliedJobs.filter((p) => p.reachedOffer).length;

  const responseTimes = appliedJobs
    .map((p) => p.daysToFirstResponse)
    .filter((d): d is number => d !== null && d >= 0);

  // Furthest-reached distribution, ordered best-first so the top of the list reads as
  // "how far you got", not as a status tally.
  const furthestCounts = new Map<string, number>();
  for (const p of progress) {
    if (p.furthestOrdinal === 0 && p.appliedAt === null) continue; // never applied
    furthestCounts.set(p.furthestStage, (furthestCounts.get(p.furthestStage) || 0) + 1);
  }
  const furthestBreakdown = PIPELINE_STAGES.filter((s) => s !== "saved")
    .map((stage) => ({
      stage,
      label: stageLabel(stage),
      count: furthestCounts.get(stage) || 0,
    }))
    .reverse();

  // Cohorts by application week — this is the "over time" part.
  const cohortsByWeek = new Map<string, PipelineCohort>();
  for (const p of appliedJobs) {
    const appliedDate = parseTs(p.appliedAt);
    if (!appliedDate) continue;
    const week = isoWeek(appliedDate);
    const cohort = cohortsByWeek.get(week) ?? {
      week,
      applied: 0,
      responded: 0,
      interviewed: 0,
      offered: 0,
    };
    cohort.applied += 1;
    if (p.reachedResponse) cohort.responded += 1;
    if (p.reachedInterview) cohort.interviewed += 1;
    if (p.reachedOffer) cohort.offered += 1;
    cohortsByWeek.set(week, cohort);
  }

  return {
    total: jobs.length,
    byStatus,
    applied: appliedJobs.length,
    responded,
    interviewed,
    offered,
    responseRate: rate(responded, appliedJobs.length),
    interviewRate: rate(interviewed, appliedJobs.length),
    offerRate: rate(offered, appliedJobs.length),
    medianDaysToFirstResponse: median(responseTimes),
    furthestBreakdown,
    cohorts: [...cohortsByWeek.values()].sort((a, b) => a.week.localeCompare(b.week)),
    progress,
  };
}
