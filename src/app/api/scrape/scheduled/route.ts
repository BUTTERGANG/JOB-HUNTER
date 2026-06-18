import { getSetting } from "@/lib/db/queries";
import { runScrapeAndAnalyze } from "@/lib/scrapeRunner";
import { sendDiscordHighScoreJobsNotification } from "@/lib/notifications/discord";

export const maxDuration = 300; // 5-minute server timeout for large scrapes

export async function GET() {
  return Response.json({
    searches: parseJsonSetting(getSetting("schedule_searches"), []),
    sites: parseJsonSetting(getSetting("schedule_sites"), ["linkedin", "indeed"]),
    results: Number(getSetting("schedule_results") ?? "25"),
    hours: Number(getSetting("schedule_hours") ?? "24"),
  });
}

export async function POST() {
  const searchesRaw = getSetting("schedule_searches");
  if (!searchesRaw) {
    return Response.json(
      { error: "No scheduled searches configured. Set them in Settings > Scheduled Scrape." },
      { status: 400 }
    );
  }

  let searches: { term: string; location: string }[];
  let sites: string[];
  try {
    searches = JSON.parse(searchesRaw);
    sites = parseJsonSetting(getSetting("schedule_sites"), ["linkedin", "indeed"]);
  } catch {
    return Response.json({ error: "Invalid schedule configuration in settings." }, { status: 400 });
  }

  if (!Array.isArray(searches) || searches.length === 0) {
    return Response.json({ error: "Schedule searches list is empty." }, { status: 400 });
  }

  const results = Number(getSetting("schedule_results") ?? "25");
  const hours = Number(getSetting("schedule_hours") ?? "24");

  const { jobs, count, dedupe, error } = await runScrapeAndAnalyze({ searches, sites, results, hours });

  if (error) {
    return Response.json({ error }, { status: 500 });
  }

  const ranAt = new Date().toISOString();
  const notification = await maybeSendDiscordNotification({ jobs, count, ranAt });

  return Response.json({ jobs, count, dedupe, notification, ran_at: ranAt });
}

async function maybeSendDiscordNotification({
  jobs,
  count,
  ranAt,
}: {
  jobs: Awaited<ReturnType<typeof runScrapeAndAnalyze>>["jobs"];
  count: number;
  ranAt: string;
}) {
  const enabled = getSetting("discord_notifications_enabled") === "true";
  const webhookUrl = getSetting("discord_webhook_url");
  const minScore = Number(getSetting("discord_min_score") ?? "70") || 70;
  const maxJobs = Math.max(1, Math.min(10, Number(getSetting("discord_max_jobs") ?? "10") || 10));
  const highScoringJobs = jobs
    .filter((job) => (job.analysis?.rankScore ?? -1) >= minScore)
    .sort((a, b) => (b.analysis?.rankScore ?? -1) - (a.analysis?.rankScore ?? -1));

  if (!enabled) {
    return { attempted: false, sent: false, highScoringCount: highScoringJobs.length };
  }
  if (!webhookUrl) {
    return {
      attempted: false,
      sent: false,
      highScoringCount: highScoringJobs.length,
      error: "Discord webhook is not configured.",
    };
  }
  if (highScoringJobs.length === 0) {
    return { attempted: false, sent: false, highScoringCount: 0 };
  }

  const result = await sendDiscordHighScoreJobsNotification({
    webhookUrl,
    jobs: highScoringJobs.slice(0, maxJobs),
    minScore,
    runAt: ranAt,
    totalFound: count,
    totalHighScoring: highScoringJobs.length,
  });

  return {
    attempted: true,
    sent: result.ok,
    highScoringCount: highScoringJobs.length,
    error: result.error,
  };
}

function parseJsonSetting<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
