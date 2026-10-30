import { NextRequest, NextResponse } from "next/server";
import { listResumes } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

/**
 * The resume arsenal.
 *
 * Every resume the app has produced, newest first, with the job it was built for and how
 * many times it has been reused — so the ones that earn their keep are visible.
 */
async function GET_handler(request: NextRequest) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const resumes = listResumes().map((row) => ({
    ...row,
    keywords: row.keywords ? (JSON.parse(row.keywords) as string[]) : [],
  }));

  return Response.json({ resumes }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
