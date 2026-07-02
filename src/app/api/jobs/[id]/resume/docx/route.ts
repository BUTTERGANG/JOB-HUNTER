import { NextRequest } from "next/server";
import { getTailoredResume, getJobById } from "@/lib/db/queries";
import { createDocxFromStructure } from "@/lib/resumeTemplate";
import { Packer } from "docx";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resume = getTailoredResume(Number(id));

  if (!resume) {
    return Response.json({ error: "No tailored resume found" }, { status: 404 });
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
      { status: 400 }
    );
  }

  const doc = createDocxFromStructure(resumeData);
  const buffer = await Packer.toBuffer(doc);

  const job = getJobById(Number(id));
  const filename = job
    ? `Resume_${job.company}_${job.role}.docx`.replace(/\s+/g, "_")
    : `Resume_${id}.docx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}