import { NextRequest, NextResponse } from "next/server";
import { getTailoredResume, saveTailoredResume } from "@/lib/db/queries";
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
  const resume = getTailoredResume(Number(id));
  if (!resume) return Response.json(null, { headers: rateLimit.headers });

  return Response.json({ content: resume.content }, { headers: rateLimit.headers });
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
