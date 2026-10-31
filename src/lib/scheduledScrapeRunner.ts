/**
 * Background runner for the scheduled scrape.
 *
 * Why this exists: the endpoint used to do the whole job inline and only respond at the end.
 * A real run is a five-term scrape (~30s) followed by ranking hundreds of listings (~5-7
 * min), which is longer than the 300-second *headers* timeout undici enforces by default —
 * and that timeout cannot be raised from the caller (an AbortSignal does not override it).
 *
 * The symptom was misleading: the caller saw "fetch failed" while the server carried on and
 * finished the work, so a successful sweep looked like an outage. The daily log at 05:49:35
 * was exactly 301s after the 05:44:34 start, and the database showed all 253 new listings
 * ranked anyway.
 *
 * Now the request returns a run id immediately and the work continues in the background, the
 * same shape the ranking backfill and the resume batch already use. It also means a dropped
 * connection can no longer make a completed sweep look like a failure.
 */

import { runScrapeAndAnalyze } from "./scrapeRunner";
import { getSetting } from "./db/queries";
import {
  formatJobSalary,
  renderJobUpdateText,
  sendViaGateway,
} from "./notifications/hermesGateway";

export interface ScheduledScrapeRun {
  runId: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  /** New listings after dedupe. */
  count: number;
  searches: { term: string; location: string }[];
  distance: number;
  hours: number;
  notification: {
    attempted: boolean;
    sent: boolean;
    via?: string;
    target?: string;
    error?: string;
    highScoringCount?: number;
  } | null;
  error: string | null;
}

let current: ScheduledScrapeRun | null = null;
let lastFinished: ScheduledScrapeRun | null = null;

export function getScheduledScrapeRun(): ScheduledScrapeRun | null {
  return current ?? lastFinished;
}

function finish(run: ScheduledScrapeRun) {
  run.finishedAt = new Date().toISOString();
  lastFinished = run;
  current = null;
}

/**
 * Notify about the run's high scorers.
 *
 * Transport: the Hermes gateway by default (one bot owns every app's messages and the
 * credential stays in Hermes), falling back to the app's own Discord webhook when one is
 * configured. `notify_via` forces either, or `off`.
 */
async function notify(
  jobs: Awaited<ReturnType<typeof runScrapeAndAnalyze>>["jobs"],
  count: number,
  ranAt: string
): Promise<ScheduledScrapeRun["notification"]> {
  const webhookUrl = getSetting("discord_webhook_url");
  const gatewayTarget = getSetting("notify_target");
  const configuredVia = getSetting("notify_via");

  const via =
    configuredVia === "gateway" || configuredVia === "webhook" || configuredVia === "off"
      ? configuredVia
      : gatewayTarget
        ? "gateway"
        : "webhook";

  const minScore = Number(getSetting("discord_min_score") ?? "70") || 70;
  const maxJobs = Math.max(1, Math.min(10, Number(getSetting("discord_max_jobs") ?? "10") || 10));

  const highScoring = jobs
    .filter((job) => (job.analysis?.rankScore ?? -1) >= minScore)
    .sort((a, b) => (b.analysis?.rankScore ?? -1) - (a.analysis?.rankScore ?? -1));

  if (via === "off") {
    return { attempted: false, sent: false, via, highScoringCount: highScoring.length };
  }
  if (highScoring.length === 0) {
    return { attempted: false, sent: false, via, highScoringCount: 0 };
  }

  const selected = highScoring.slice(0, maxJobs);

  if (via === "gateway") {
    const target = gatewayTarget || "discord:#general";
    const result = await sendViaGateway(
      target,
      renderJobUpdateText({
        jobs: selected.map((job) => ({
          rankScore: job.analysis?.rankScore ?? 0,
          company: job.company || "Unknown company",
          role: job.role,
          url: job.url ?? null,
          location: job.location ?? null,
          salary: formatJobSalary(job.salaryMin ?? null, job.salaryMax ?? null),
          source: job.source ?? null,
        })),
        minScore,
        runAt: ranAt,
        totalFound: count,
        totalHighScoring: highScoring.length,
      })
    );
    return {
      attempted: true,
      sent: result.ok,
      via,
      target,
      error: result.error,
      highScoringCount: highScoring.length,
    };
  }

  if (!webhookUrl) {
    return {
      attempted: false,
      sent: false,
      via,
      error: "No Discord webhook configured (and notify_target is not set).",
      highScoringCount: highScoring.length,
    };
  }

  const { sendDiscordHighScoreJobsNotification } = await import("./notifications/discord");
  const result = await sendDiscordHighScoreJobsNotification({
    webhookUrl,
    jobs: selected,
    minScore,
    runAt: ranAt,
    totalFound: count,
    totalHighScoring: highScoring.length,
  });
  return {
    attempted: true,
    sent: result.ok,
    via,
    error: result.error,
    highScoringCount: highScoring.length,
  };
}

export function startScheduledScrape(config: {
  searches: { term: string; location: string }[];
  sites: string[];
  results: number;
  hours: number;
  distance: number;
}): { runId: string } | { error: string } {
  if (current) {
    return { error: "A scheduled scrape is already running." };
  }

  const runId = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const run: ScheduledScrapeRun = {
    runId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    count: 0,
    searches: config.searches,
    distance: config.distance,
    hours: config.hours,
    notification: null,
    error: null,
  };
  current = run;

  void (async () => {
    try {
      const { jobs, count, error } = await runScrapeAndAnalyze(config);
      if (error) {
        run.status = "failed";
        run.error = error;
        finish(run);
        return;
      }
      run.count = count;
      const ranAt = new Date().toISOString();
      // A notification failure must not mark the sweep as failed — the jobs were collected.
      run.notification = await notify(jobs, count, ranAt).catch((e) => ({
        attempted: true,
        sent: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      run.status = "done";
      finish(run);
    } catch (e) {
      run.status = "failed";
      run.error = e instanceof Error ? e.message : String(e);
      finish(run);
    }
  })();

  return { runId };
}
