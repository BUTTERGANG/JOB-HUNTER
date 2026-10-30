import { NextRequest, NextResponse } from "next/server";
import { getResumeById } from "@/lib/db/queries";
import { createDocxFromStructure } from "@/lib/resumeTemplate";
import { Packer } from "docx";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

/**
 * Export any resume in the arsenal as .docx.
 *
 * Distinct from /api/jobs/[id]/resume/docx, which exports whatever is attached to a job.
 * This one renders a resume row directly, so a resume can be downloaded from the library
 * without first finding the job it came from.
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
  const resume = getResumeById(Number(id));
  if (!resume) {
    return Response.json({ error: "No resume found" }, { status: 404, headers: rateLimit.headers });
  }

  let structure;
  try {
    const parsed = JSON.parse(resume.content);
    if (typeof parsed === "string" || !parsed.professionalSummary) throw new Error("Legacy format");
    structure = parsed;
  } catch {
    // Legacy markdown resumes have no structure to render.
    return Response.json(
      { error: "This resume is legacy markdown and cannot be exported to Word. Re-tailor it to get a structured one." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const doc = createDocxFromStructure(structure);
  const buffer = await Packer.toBuffer(doc);
  const slug = (resume.label ?? `resume-${resume.id}`)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...rateLimit.headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${slug || `resume-${resume.id}`}.docx"`,
    },
  });
}

export const GET = GET_handler;
