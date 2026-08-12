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

  // Validate input
  let validatedConfig;
  try {
    validatedConfig = validateScrapeConfig({ searches, sites, results, hours, resultsBySite });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400 });
  }

  // bulkMode = per-state calls from the all-states scanner (1 search but needs extended timeout)
  // isLargeBatch = multi-search batch (e.g. >10 searches in one call)
  const { bulkMode } = body;
  const isLargeBatch = Array.isArray(searches) && searches.length > 10;
  const timeoutMs = (bulkMode || isLargeBatch) ? 300_000 : 120_000;

  const { jobs, count, dedupe, siteStatus, error, saveWarning } = await runScrapeAndAnalyze(
    { searches, sites, results, hours, resultsBySite },
    { timeoutMs, skipAnalysis: skipAnalysis ?? false, skipDedupe: skipDedupe ?? false }
  );

  if (error) {
    // Include siteStatus so the client can show *why* a state failed (block vs timeout).
    return Response.json({ error, siteStatus }, { status: 500 });
  }

  return Response.json({ jobs, count, dedupe, siteStatus, saveWarning }, { headers: rateLimit.headers });
}

export { POST };
