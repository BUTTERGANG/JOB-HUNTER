import { NextRequest } from "next/server";
import { getTailoredResume } from "@/lib/db/queries";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resume = getTailoredResume(Number(id));
  if (!resume) return Response.json(null);

  return Response.json({ content: resume.content });
}
