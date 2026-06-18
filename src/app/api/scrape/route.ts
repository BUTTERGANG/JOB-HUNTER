import { NextRequest } from "next/server";
import { runScrapeAndAnalyze } from "@/lib/scrapeRunner";

export async function POST(request: NextRequest) {
  const config = await request.json();
  const { jobs, count, dedupe, error } = await runScrapeAndAnalyze(config);

  if (error) {
    const status = error.includes("python-jobspy not installed") ? 500 : 500;
    return Response.json({ error }, { status });
  }

  return Response.json({ jobs, count, dedupe });
}
