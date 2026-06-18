import { NextRequest } from "next/server";
import { runScrapeAndAnalyze } from "@/lib/scrapeRunner";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { searches, sites, results, hours, skipAnalysis, skipDedupe } = body;

  // Large batch (e.g. all 50 states) gets a longer timeout
  const isLargeBatch = Array.isArray(searches) && searches.length > 10;
  const timeoutMs = isLargeBatch ? 600_000 : 120_000;

  const { jobs, count, dedupe, error } = await runScrapeAndAnalyze(
    { searches, sites, results, hours },
    { timeoutMs, skipAnalysis: skipAnalysis ?? false, skipDedupe: skipDedupe ?? false }
  );

  if (error) {
    return Response.json({ error }, { status: 500 });
  }

  return Response.json({ jobs, count, dedupe });
}
