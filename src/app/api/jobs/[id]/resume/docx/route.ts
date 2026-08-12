import { NextRequest, NextResponse } from "next/server";
import { getTailoredResume, getJobById } from "@/lib/db/queries";
import { createDocxFromStructure } from "@/lib/resumeTemplate";
import { Packer } from "docx";
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

  if (!resume) {
    return Response.json({ error: "No tailored resume found" }, { status: 404, headers: rateLimit.headers });
  }

  // Handle both legacy markdown and new JSON format
  let resumeData;
  try {
    resumeData = JSON.parse(resume.content);
    // Check if it's the old markdown format (not our structured JSON)
    if (typeof resumeData === "string" || !resumeData.professionalSummary) {
      throw new Error("Legacy format");
    }
  } catch {
    // Legacy format - can't generate DOCX from markdown
    return Response.json(
      { error: "Resume is in legacy markdown format. Re-generate for DOCX export." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const doc = createDocxFromStructure(resumeData);
  const buffer = await Packer.toBuffer(doc);

  const job = getJobById(Number(id));
  const filename = job
    ? `Resume_${job.company}_${job.role}.docx`.replace(/\s+/g, "_")
    : `Resume_${id}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...rateLimit.headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const GET = GET_handler;