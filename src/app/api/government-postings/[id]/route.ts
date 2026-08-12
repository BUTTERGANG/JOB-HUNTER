import { NextRequest, NextResponse } from "next/server";
import { getGovScrapeRunById, getGovScrapeResultsByRunId, deleteGovScrapeRun } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function GET_handler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  const run = getGovScrapeRunById(Number(id));
  if (!run) return Response.json({ error: "Not found" }, { status: 404, headers: rateLimit.headers });
  const results = getGovScrapeResultsByRunId(Number(id));
  return Response.json({ ...run, results }, { headers: rateLimit.headers });
}

async function DELETE_handler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  const run = getGovScrapeRunById(Number(id));
  if (!run) return Response.json({ error: "Not found" }, { status: 404, headers: rateLimit.headers });
  deleteGovScrapeRun(Number(id));
  return Response.json({ success: true }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
export const DELETE = DELETE_handler;
