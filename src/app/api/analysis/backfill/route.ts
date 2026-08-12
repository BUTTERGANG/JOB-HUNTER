import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/index";
import { scrapeResults, jobAnalysis, analysisRuns } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { startAnalysisRun, cancelAnalysisRun, getActiveAnalysisRunId } from "@/lib/analysisRunner";
import { getAnalysisRun, getActiveAnalysisRun } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";
import { withAuth } from "@/lib/authMiddleware";

// GET — counts + active run status
async function GET_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const d = db();

  const [{ total }] = d
    .select({ total: sql<number>`count(*)` })
    .from(scrapeResults)
    .all() as [{ total: number }];

  const [{ analyzed }] = d
    .select({ analyzed: sql<number>`count(*)` })
    .from(jobAnalysis)
    .all() as [{ analyzed: number }];

  const unanalyzed = Number(total) - Number(analyzed);
  const activeRun = getActiveAnalysisRun();

  const recentRuns = d
    .select()
    .from(analysisRuns)
    .orderBy(desc(analysisRuns.startedAt))
    .limit(5)
    .all();

  return Response.json({
    total: Number(total),
    analyzed: Number(analyzed),
    unanalyzed,
    activeRun: activeRun ?? null,
    recentRuns,
  }, { headers: rateLimit.headers });
}

// POST — start a new analysis run (or cancel existing)
async function POST_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimit.headers });
  }

  const body = await request.json().catch(() => ({}));

  if (body.cancel) {
    const activeId = getActiveAnalysisRunId();
    if (!activeId) return Response.json({ error: "No active run to cancel." }, { status: 404, headers: rateLimit.headers });
    const cancelled = cancelAnalysisRun(activeId);
    return Response.json({ cancelled, runId: activeId }, { headers: rateLimit.headers });
  }

  const result = startAnalysisRun();
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400, headers: rateLimit.headers });
  }

  return Response.json({ runId: result.runId, total: result.total }, { headers: rateLimit.headers });
}

// GET with ?runId= — poll a specific run
async function PATCH_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: rateLimit.headers });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) return Response.json({ error: "runId required" }, { status: 400, headers: rateLimit.headers });
  const run = getAnalysisRun(runId);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404, headers: rateLimit.headers });
  return Response.json({ run }, { headers: rateLimit.headers });
}

export const GET = withAuth(GET_handler, "analyze");
export const POST = withAuth(POST_handler, "analyze");
export const PATCH = withAuth(PATCH_handler, "analyze");
