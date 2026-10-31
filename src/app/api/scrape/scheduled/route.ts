import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db/queries";
import { getScheduledScrapeRun, startScheduledScrape } from "@/lib/scheduledScrapeRunner";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";
import { parseJsonStringArray, parseJson } from "@/lib/json";

function limited(request: NextRequest, strict = false) {
  const rateLimit = (strict ? generalRateLimiter : generalRateLimiter)(getClientIdentifier(request));
  if (rateLimit.allowed) return null;
  return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: { ...rateLimit.headers, "Content-Type": "application/json" },
  });
}

/** The schedule configuration, plus the state of the current or last run. */
async function GET_handler(request: NextRequest) {
  const denied = limited(request);
  if (denied) return denied;

  return Response.json({
    searches: parseJson(getSetting("schedule_searches"), [] as { term: string; location: string }[]),
    sites: parseJsonStringArray(getSetting("schedule_sites")),
    results: Number(getSetting("schedule_results") ?? "100"),
    hours: Number(getSetting("schedule_hours") ?? "720"),
    // Radius matters as much as the term: jobspy silently defaults to 50 miles, and
    // 50 → 100 measured ~70% more listings for this market.
    distance: Number(getSetting("schedule_distance") ?? "100"),
    run: getScheduledScrapeRun(),
  });
}

/**
 * Start a scheduled scrape.
 *
 * Returns as soon as the run is registered — it does NOT wait for the scrape and ranking.
 * Doing the work inline took longer than the 300-second headers timeout that HTTP clients
 * enforce by default, so a real run could never answer in time and the caller saw
 * "fetch failed" while the server carried on and finished anyway. Poll GET for the outcome.
 */
async function POST_handler(request: NextRequest) {
  const denied = limited(request, true);
  if (denied) return denied;

  const searchesRaw = getSetting("schedule_searches");
  if (!searchesRaw) {
    return Response.json(
      { error: "No scheduled searches configured. Set them in Settings > Scheduled Scrape." },
      { status: 400 }
    );
  }

  const searches = parseJson<{ term: string; location: string }[]>(searchesRaw, []);
  const sites = parseJsonStringArray(getSetting("schedule_sites"));
  if (searches.length === 0) {
    return Response.json({ error: "Schedule searches list is empty." }, { status: 400 });
  }

  const started = startScheduledScrape({
    searches,
    sites: sites.length > 0 ? sites : ["indeed"],
    results: Number(getSetting("schedule_results") ?? "100"),
    hours: Number(getSetting("schedule_hours") ?? "720"),
    distance: Number(getSetting("schedule_distance") ?? "100"),
  });

  if ("error" in started) {
    return Response.json({ error: started.error }, { status: 409 });
  }
  return Response.json({ ...started, status: "running" }, { status: 202 });
}

export const GET = GET_handler;
export const POST = POST_handler;
