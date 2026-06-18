import { getAllScrapeRuns } from "@/lib/db/queries";

export async function GET() {
  const runs = getAllScrapeRuns();
  return Response.json(runs);
}
