import { NextRequest, NextResponse } from "next/server";
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
    keywords: JSON.parse(analysis.keywords || "[]"),
    fitScore: analysis.fitScore ?? 0,
    redFlags: JSON.parse(analysis.redFlags || "[]"),
    mustHave: JSON.parse(analysis.mustHave || "[]"),
    niceToHave: JSON.parse(analysis.niceToHave || "[]"),
    questions: JSON.parse(analysis.questions || "[]"),
  }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
