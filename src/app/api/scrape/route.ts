import { NextRequest, NextResponse } from "next/server";
import { runScrapeAndAnalyze } from "@/lib/scrapeRunner";
import { validateScrapeConfig } from "@/lib/validation";
import { scrapeRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

export const maxDuration = 300;

async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimit = scrapeRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { searches, sites, results, hours, resultsBySite, skipAnalysis, skipDedupe } = body;

  // Validate input.
  //
  // The validation result used to be assigned and then ignored: `ok: false`
  // (e.g. results=99999, an unknown site, an empty search list) was never
  // checked, and the scrape ran on the RAW body values rather than the
  // sanitised ones. Both now feed the run.
  let validated: ReturnType<typeof validateScrapeConfig>;
  try {
    validated = validateScrapeConfig({ searches, sites, results, hours, resultsBySite });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400 });
  }
  if (!validated.ok || !validated.data) {
    return Response.json({ error: validated.error ?? "Invalid scrape configuration" }, { status: 400 });
  }
  const config = validated.data;

  // bulkMode = per-state calls from the all-states scanner (1 search but needs extended timeout)
  // isLargeBatch = multi-search batch (e.g. >10 searches in one call)
  const { bulkMode } = body;
  const isLargeBatch = config.searches.length > 10;
  const timeoutMs = (bulkMode || isLargeBatch) ? 300_000 : 120_000;

  const { jobs, count, dedupe, siteStatus, error, saveWarning } = await runScrapeAndAnalyze(
    {
      searches: config.searches,
      sites: config.sites,
      results: config.results,
      hours: config.hours,
      resultsBySite: config.resultsBySite,
    },
    { timeoutMs, skipAnalysis: skipAnalysis ?? false, skipDedupe: skipDedupe ?? false }
  );

  if (error) {
    // Include siteStatus so the client can show *why* a state failed (block vs timeout).
    return Response.json({ error, siteStatus }, { status: 500 });
  }

  return Response.json({ jobs, count, dedupe, siteStatus, saveWarning }, { headers: rateLimit.headers });
}

export { POST };
