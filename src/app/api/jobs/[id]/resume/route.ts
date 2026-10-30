import { NextRequest, NextResponse } from "next/server";
import { getTailoredResume, saveTailoredResume, recommendResumeForJob } from "@/lib/db/queries";
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
  const jobId = Number(id);
  const resume = getTailoredResume(jobId);

  // Returned alongside the resume because the detail page needs both: what this job
  // currently has, and which existing resume in the arsenal would fit it better. One
  // request instead of two, and the recommendation is what stops a fresh tailoring.
  const recommendation = recommendResumeForJob(jobId)?.recommendation ?? null;

  return Response.json(
    {
      content: resume?.content ?? null,
      resume: resume
        ? {
            id: resume.id,
            type: resume.type,
            label: resume.label,
            reuseCount: resume.reuseCount,
            sourceResumeId: resume.sourceResumeId,
          }
        : null,
      recommendation,
    },
    { headers: rateLimit.headers }
  );
}

// Persist hand-edited résumé content so manual tweaks survive navigation.
async function PUT_handler(
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
  const body = await request.json().catch(() => ({}));
  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400, headers: rateLimit.headers });
  }
  saveTailoredResume(Number(id), body.content);
  return Response.json({ ok: true }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
export const PUT = PUT_handler;
