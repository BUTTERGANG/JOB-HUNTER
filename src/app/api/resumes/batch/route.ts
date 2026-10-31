import { NextRequest, NextResponse } from "next/server";
import {
  cancelResumeBatch,
  getResumeBatchRun,
  startResumeBatch,
} from "@/lib/resumeBatchRunner";
import { aiRateLimiter, generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

/** Progress of the current or most recent batch. */
async function GET_handler(request: NextRequest) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }
  return Response.json({ run: getResumeBatchRun() }, { headers: rateLimit.headers });
}

/**
 * Start a batch over the top-ranked untracked listings.
 *
 * The origin is taken from the request so the runner can call this app's own tailor
 * endpoint — one implementation of the tailoring prompt, not a second copy that drifts.
 */
async function POST_handler(request: NextRequest) {
  const rateLimit = aiRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => ({}));
  const minScore = Number(body?.minScore ?? 70);
  const limit = Number(body?.limit ?? 5);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    return Response.json({ error: "minScore must be between 0 and 100" }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit < 1 || limit > 25) {
    return Response.json({ error: "limit must be between 1 and 25" }, { status: 400 });
  }

  const started = startResumeBatch({ origin: new URL(request.url).origin, minScore, limit });
  if ("error" in started) {
    return Response.json({ error: started.error }, { status: 400, headers: rateLimit.headers });
  }
  return Response.json(started, { headers: rateLimit.headers });
}

async function DELETE_handler(request: NextRequest) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }
  return Response.json({ cancelled: cancelResumeBatch() }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
export const POST = POST_handler;
export const DELETE = DELETE_handler;
