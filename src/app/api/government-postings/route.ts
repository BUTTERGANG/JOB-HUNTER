import { NextRequest, NextResponse } from "next/server";
import { getAllGovScrapeRuns } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function GET_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const runs = getAllGovScrapeRuns();
  return Response.json(runs, { headers: rateLimit.headers });
}

export const GET = GET_handler;
