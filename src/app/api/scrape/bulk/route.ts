import { NextRequest, NextResponse } from "next/server";
import { startBulkScan, cancelBulkScan, type BulkScanConfig } from "@/lib/bulkScanRunner";
import { getBulkRun, getActiveBulkRun, type BulkRunProgress } from "@/lib/db/queries";
import type { BulkRunRow } from "@/lib/db/schema";
import { validateBulkScanConfig } from "@/lib/validation";
import { bulkScanRateLimiter, generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

function serialize(row: BulkRunRow) {
  let progress: BulkRunProgress = { errors: [] };
  try {
    if (row.progress) progress = JSON.parse(row.progress);
  } catch {}
  return {
    runId: row.id,
    status: row.status,
    total: row.total,
    done: row.done,
    jobsTotal: row.jobsTotal,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    current: progress.current ?? null,
    errors: progress.errors ?? [],
  };
}

// Start a background all-states scan. Returns a runId immediately; the work runs
// server-side so it survives navigation, reload, and closing the tab.
async function POST_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = bulkScanRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();

  const active = getActiveBulkRun();
  if (active) {
    return Response.json(
      { error: "A bulk scan is already running.", runId: active.id },
      { status: 409, headers: rateLimit.headers }
    );
  }

  // Validate input
  let validatedConfig;
  try {
    validatedConfig = validateBulkScanConfig(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid request" }, { status: 400, headers: rateLimit.headers });
  }
  if (!validatedConfig.ok || !validatedConfig.data) {
    return Response.json({ error: validatedConfig.error ?? "Invalid request" }, { status: 400, headers: rateLimit.headers });
  }

  const config: BulkScanConfig = {
    sites: validatedConfig.data.sites,
    resultsBySite: validatedConfig.data.resultsBySite,
    hours: validatedConfig.data.hours,
    term: validatedConfig.data.term,
    broadSearch: validatedConfig.data.broadSearch,
    concurrency: validatedConfig.data.concurrency,
  };

  const runId = startBulkScan(config);
  return Response.json({ runId }, { headers: rateLimit.headers });
}

// Poll run status. ?runId=… for a specific run, otherwise the most recent active run.
async function GET_handler(request: NextRequest) {
  // Light rate limiting for polling
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  const row = runId ? getBulkRun(runId) : getActiveBulkRun();
  if (!row) return Response.json({ run: null }, { headers: rateLimit.headers });
  return Response.json({ run: serialize(row) }, { headers: rateLimit.headers });
}

// Cancel a running scan.
async function DELETE_handler(request: NextRequest) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) return Response.json({ error: "runId required" }, { status: 400, headers: rateLimit.headers });
  const cancelled = cancelBulkScan(runId);
  return Response.json({ cancelled }, { headers: rateLimit.headers });
}

// Export the auth-wrapped handlers for Next.js
export const POST = POST_handler;
export const GET = GET_handler;
export const DELETE = DELETE_handler;
