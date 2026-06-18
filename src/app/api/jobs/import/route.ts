import { NextRequest } from "next/server";
import { createJob, findExistingJobByIdentity } from "@/lib/db/queries";

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!Array.isArray(body.jobs)) {
    return Response.json({ error: "Expected { jobs: [...] }" }, { status: 400 });
  }

  const results = {
    created: 0,
    skippedDuplicates: 0,
    errors: [] as string[],
    duplicates: [] as Array<{ role: string; company: string; existingJobId: number }>,
  };

  for (const row of body.jobs) {
    try {
      if (!row.company || !row.role) {
        results.errors.push(`Missing company or role: ${JSON.stringify(row).slice(0, 100)}`);
        continue;
      }

      const existing = findExistingJobByIdentity({
        company: row.company,
        role: row.role,
        location: row.location || null,
        url: row.url || null,
      });
      if (existing) {
        results.skippedDuplicates++;
        results.duplicates.push({
          role: row.role,
          company: row.company,
          existingJobId: existing.id,
        });
        continue;
      }

      createJob({
        company: row.company,
        role: row.role,
        location: row.location || null,
        salaryMin: row.salaryMin ? Number(row.salaryMin) : null,
        salaryMax: row.salaryMax ? Number(row.salaryMax) : null,
        url: row.url || null,
        source: row.source || null,
        description: row.description || null,
        status: row.status || "saved",
        tier: row.tier || "B",
        notes: row.notes || null,
      });
      results.created++;
    } catch (e) {
      results.errors.push(`Error creating job: ${(e as Error).message}`);
    }
  }

  return Response.json(results, { status: 201 });
}
