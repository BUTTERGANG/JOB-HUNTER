import { getSetting } from "@/lib/db/queries";
import { runScrapeAndAnalyze } from "@/lib/scrapeRunner";
import { sendDiscordHighScoreJobsNotification } from "@/lib/notifications/discord";
import {
  formatJobSalary,
  renderJobUpdateText,
  sendViaGateway,
} from "@/lib/notifications/hermesGateway";
import { NextRequest, NextResponse } from "next/server";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

export const maxDuration = 300; // 5-minute server timeout for large scrapes

async function GET_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  return Response.json({
    searches: parseJsonSetting(getSetting("schedule_searches"), []),
    sites: parseJsonSetting(getSetting("schedule_sites"), ["indeed"]),
    results: Number(getSetting("schedule_results") ?? "100"),
    hours: Number(getSetting("schedule_hours") ?? "720"),
    // Radius matters as much as the term: jobspy silently defaults to 50 miles, and
    // 50 → 100 measured ~70% more listings for this market.
    distance: Number(getSetting("schedule_distance") ?? "100"),
  }, { headers: rateLimit.headers });
}

async function POST_handler(request: NextRequest) {
  // Rate limiting - very strict for scheduled runs (one per minute max)
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const searchesRaw = getSetting("schedule_searches");
  if (!searchesRaw) {
    return Response.json(
      { error: "No scheduled searches configured. Set them in Settings > Scheduled Scrape." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  let searches: { term: string; location: string }[];
  let sites: string[];
  try {
    searches = JSON.parse(searchesRaw);
    sites = parseJsonSetting(getSetting("schedule_sites"), ["indeed"]);
  } catch {
    return Response.json({ error: "Invalid schedule configuration in settings." }, { status: 400, headers: rateLimit.headers });
  }

  if (!Array.isArray(searches) || searches.length === 0) {
    return Response.json({ error: "Schedule searches list is empty." }, { status: 400, headers: rateLimit.headers });
  }

  const results = Number(getSetting("schedule_results") ?? "100");
  const hours = Number(getSetting("schedule_hours") ?? "720");
  // This was never passed, so every scheduled run silently used jobspy's 50-mile default —
  // the single most expensive omission measured during the search-yield work.
  const distance = Number(getSetting("schedule_distance") ?? "100");

  const { jobs, count, dedupe, error } = await runScrapeAndAnalyze({
    searches,
    sites,
    results,
    hours,
    distance,
  });

  if (error) {
    return Response.json({ error }, { status: 500, headers: rateLimit.headers });
  }

  const ranAt = new Date().toISOString();
  const notification = await maybeSendDiscordNotification({ jobs, count, ranAt });

  return Response.json({ jobs, count, dedupe, notification, ran_at: ranAt }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
export const POST = POST_handler;

async function maybeSendDiscordNotification({
  jobs,
  count,
  ranAt,
}: {
  jobs: Awaited<ReturnType<typeof runScrapeAndAnalyze>>["jobs"];
  count: number;
  ranAt: string;
}) {
  const webhookUrl = getSetting("discord_webhook_url");
  const gatewayTarget = getSetting("notify_target");
  const configuredVia = getSetting("notify_via");

  // Which transport. Default: use the gateway when a target is set (one bot, credentials
  // stay in Hermes), otherwise fall back to a webhook if one is configured. `notify_via`
  // overrides the guess.
  const via =
    configuredVia === "gateway" || configuredVia === "webhook" || configuredVia === "off"
      ? configuredVia
      : gatewayTarget
        ? "gateway"
        : "webhook";

  const enabled =
    via !== "off" &&
    (getSetting("discord_notifications_enabled") === "true" || via === "gateway");

  const minScore = Number(getSetting("discord_min_score") ?? "70") || 70;
  const maxJobs = Math.max(1, Math.min(10, Number(getSetting("discord_max_jobs") ?? "10") || 10));
  const highScoringJobs = jobs
    .filter((job) => (job.analysis?.rankScore ?? -1) >= minScore)
    .sort((a, b) => (b.analysis?.rankScore ?? -1) - (a.analysis?.rankScore ?? -1));

  if (!enabled) {
    return { attempted: false, sent: false, highScoringCount: highScoringJobs.length, via };
  }
  if (highScoringJobs.length === 0) {
    return { attempted: false, sent: false, highScoringCount: 0, via };
  }

  const selected = highScoringJobs.slice(0, maxJobs);

  if (via === "gateway") {
    const target = gatewayTarget || "discord:#general";
    const text = renderJobUpdateText({
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
      totalHighScoring: highScoringJobs.length,
    });
    const result = await sendViaGateway(target, text);
    return {
      attempted: true,
      sent: result.ok,
      highScoringCount: highScoringJobs.length,
      via,
      target,
      error: result.error,
    };
  }

  if (!webhookUrl) {
    return {
      attempted: false,
      sent: false,
      highScoringCount: highScoringJobs.length,
      via,
      error: "Discord webhook is not configured.",
    };
  }

  const result = await sendDiscordHighScoreJobsNotification({
    webhookUrl,
    jobs: selected,
    minScore,
    runAt: ranAt,
    totalFound: count,
    totalHighScoring: highScoringJobs.length,
  });

  return {
    attempted: true,
    sent: result.ok,
    highScoringCount: highScoringJobs.length,
    via,
    error: result.error,
  };
}

function parseJsonSetting<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
