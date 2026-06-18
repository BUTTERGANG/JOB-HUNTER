import { NextRequest } from "next/server";
import { getScrapeRunById, getScrapeResultsByRunId, deleteScrapeRun } from "@/lib/db/queries";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = getScrapeRunById(Number(id));
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const results = getScrapeResultsByRunId(Number(id));
  return Response.json({ ...run, results });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = getScrapeRunById(Number(id));
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  deleteScrapeRun(Number(id));
  return Response.json({ success: true });
}
