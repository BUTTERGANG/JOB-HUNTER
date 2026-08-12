import { NextRequest, NextResponse } from "next/server";
import { createJob, findExistingJobByIdentity } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function POST_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();

  if (!Array.isArray(body.jobs)) {
    return Response.json({ error: "Expected { jobs: [...] }" }, { status: 400, headers: rateLimit.headers });
  }

  const results = {
    created: 0,
    skippedDuplicates: 0,
    errors: [] as string[],
    duplicates: [] as Array<{ role: string; company: string; existingJobId: number }>,
  };

  for (const row of body.jobs) {
    try {
      const role = (row.role ?? "").trim();
      const company = (row.company ?? "").trim();
      const url = (row.url ?? "").trim();

      // A job is trackable as long as it has a role plus at least one identity
      // anchor (company or URL). Scraped listings — especially Indeed — sometimes
      // omit the company; reject only when we truly can't identify the job.
      if (!role || (!company && !url)) {
        results.errors.push(`Missing role, or both company and URL: ${JSON.stringify(row).slice(0, 100)}`);
        continue;
      }

      const existing = findExistingJobByIdentity({
        company: company || null,
        role,
        location: row.location || null,
        url: url || null,
      });
      if (existing) {
        results.skippedDuplicates++;
        results.duplicates.push({
          role,
          company,
          existingJobId: existing.id,
        });
        continue;
      }

      createJob({
        // company is NOT NULL in the schema; use a clear placeholder when a
        // scraped listing didn't include one (the user can edit it later).
        company: company || "Unknown company",
        role,
        location: row.location || null,
        salaryMin: row.salaryMin ? Number(row.salaryMin) : null,
        salaryMax: row.salaryMax ? Number(row.salaryMax) : null,
        url: url || null,
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

  return Response.json(results, { status: 201, headers: rateLimit.headers });
}

export const POST = POST_handler;
