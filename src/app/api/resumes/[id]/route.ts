import { NextRequest, NextResponse } from "next/server";
import { deleteResume, getResumeById, renameResume, reuseResumeForJob } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

function limited(request: NextRequest) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (rateLimit.allowed) return null;
  return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: { ...rateLimit.headers, "Content-Type": "application/json" },
  });
}

/** Rename a resume in the arsenal. */
async function PATCH_handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = limited(request);
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return Response.json({ error: "label is required" }, { status: 400 });
  if (!getResumeById(Number(id))) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ resume: renameResume(Number(id), label) });
}

/** Delete a resume from the arsenal. */
async function DELETE_handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = limited(request);
  if (denied) return denied;

  const { id } = await params;
  if (!getResumeById(Number(id))) return Response.json({ error: "Not found" }, { status: 404 });
  deleteResume(Number(id));
  return Response.json({ ok: true });
}

/**
 * Reuse this resume for another job — the whole point of the arsenal.
 *
 * Copies the content onto the target job rather than pointing at it, so the detail page
 * and the DOCX export keep working unchanged, and records provenance on the copy.
 */
async function POST_handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = limited(request);
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const jobId = Number(body.jobId);
  if (!Number.isFinite(jobId)) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }
  if (!getResumeById(Number(id))) return Response.json({ error: "Resume not found" }, { status: 404 });

  const copy = reuseResumeForJob(jobId, Number(id));
  if (!copy) return Response.json({ error: "Could not reuse that resume" }, { status: 400 });

  return Response.json({ resume: copy });
}

export const PATCH = PATCH_handler;
export const DELETE = DELETE_handler;
export const POST = POST_handler;
