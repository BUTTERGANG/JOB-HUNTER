import { NextRequest, NextResponse } from "next/server";
import {
  addJobStep,
  completeJobStep,
  deleteJobStep,
  getJobById,
  getJobStageEvents,
  getJobSteps,
  reopenJobStep,
} from "@/lib/db/queries";
import { computeJobProgress } from "@/lib/pipeline";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

/**
 * Next steps for one tracked job, plus its stage history.
 *
 * The history is returned alongside the steps because they are two halves of the same
 * question — "what do I do next" and "how far have I got" — and the detail view renders
 * both, so one request serves it.
 */
async function GET_handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  const jobId = Number(id);
  const job = getJobById(jobId);
  if (!job) return Response.json({ error: "Not found" }, { status: 404, headers: rateLimit.headers });

  const events = getJobStageEvents(jobId);
  const progress = computeJobProgress(
    {
      id: job.id,
      company: job.company,
      role: job.role,
      status: job.status,
      dateApplied: job.dateApplied,
      followUpDate: job.followUpDate,
    },
    events
  );

  return Response.json(
    { steps: getJobSteps(jobId), events, progress },
    { headers: rateLimit.headers }
  );
}

async function POST_handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  const jobId = Number(id);
  if (!getJobById(jobId)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: rateLimit.headers });
  }

  const body = await request.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return Response.json({ error: "label is required" }, { status: 400, headers: rateLimit.headers });
  }

  const step = addJobStep({
    jobId,
    label,
    detail: typeof body?.detail === "string" && body.detail.trim() ? body.detail.trim() : null,
    dueDate: typeof body?.dueDate === "string" && body.dueDate ? body.dueDate : null,
  });

  return Response.json({ step, steps: getJobSteps(jobId) }, { headers: rateLimit.headers });
}

async function PATCH_handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const { id } = await params;
  const jobId = Number(id);
  if (!getJobById(jobId)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: rateLimit.headers });
  }

  const body = await request.json().catch(() => null);
  const stepId = Number(body?.stepId);
  const action = body?.action;
  if (!Number.isFinite(stepId)) {
    return Response.json({ error: "stepId is required" }, { status: 400, headers: rateLimit.headers });
  }
  if (!["complete", "reopen", "delete"].includes(action)) {
    return Response.json(
      { error: "action must be complete, reopen or delete" },
      { status: 400, headers: rateLimit.headers }
    );
  }

  if (action === "complete") completeJobStep(stepId);
  else if (action === "reopen") reopenJobStep(stepId);
  else deleteJobStep(stepId);

  // Return the refreshed job too: completing an "Apply" step moves the job to applied,
  // so the caller needs the new status to stay in sync without a second fetch.
  return Response.json(
    {
      steps: getJobSteps(jobId),
      events: getJobStageEvents(jobId),
      job: getJobById(jobId),
    },
    { headers: rateLimit.headers }
  );
}

export const GET = GET_handler;
export const POST = POST_handler;
export const PATCH = PATCH_handler;
