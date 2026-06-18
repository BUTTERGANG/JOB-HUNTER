import { NextRequest } from "next/server";
import { getAnalysis } from "@/lib/db/queries";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const analysis = getAnalysis(Number(id));
  if (!analysis) return Response.json(null);

  return Response.json({
    keywords: JSON.parse(analysis.keywords || "[]"),
    fitScore: analysis.fitScore ?? 0,
    redFlags: JSON.parse(analysis.redFlags || "[]"),
    mustHave: JSON.parse(analysis.mustHave || "[]"),
    niceToHave: JSON.parse(analysis.niceToHave || "[]"),
    questions: JSON.parse(analysis.questions || "[]"),
  });
}
