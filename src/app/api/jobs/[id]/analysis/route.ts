import { NextRequest, NextResponse } from "next/server";
import { parseJsonStringArray } from "@/lib/json";
import { getAnalysis } from "@/lib/db/queries";
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
  const analysis = getAnalysis(Number(id));
  if (!analysis) return Response.json(null, { headers: rateLimit.headers });

  return Response.json({
    keywords: parseJsonStringArray(analysis.keywords),
    fitScore: analysis.fitScore ?? 0,
    redFlags: parseJsonStringArray(analysis.redFlags),
    mustHave: parseJsonStringArray(analysis.mustHave),
    niceToHave: parseJsonStringArray(analysis.niceToHave),
    questions: parseJsonStringArray(analysis.questions),
  }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
