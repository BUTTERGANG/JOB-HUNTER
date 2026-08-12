import { NextRequest, NextResponse } from "next/server";
import { getAllJobs, createJob, findExistingJobByIdentity } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function GET_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const data = getAllJobs();
  return Response.json(data, { headers: rateLimit.headers });
}

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

  if (!body.company || !body.role) {
    return Response.json({ error: "Company and role are required" }, { status: 400, headers: rateLimit.headers });
  }

  const existing = findExistingJobByIdentity({
    company: body.company,
    role: body.role,
    location: body.location || null,
    url: body.url || null,
  });
  if (existing) {
    return Response.json(
      { error: "This job is already in your tracker.", existingJobId: existing.id },
      { status: 409, headers: rateLimit.headers }
    );
  }

  const job = createJob({
    company: body.company,
    role: body.role,
    location: body.location || null,
    salaryMin: body.salaryMin ? Number(body.salaryMin) : null,
    salaryMax: body.salaryMax ? Number(body.salaryMax) : null,
    url: body.url || null,
    source: body.source || null,
    description: body.description || null,
    status: body.status || "saved",
    tier: body.tier || "B",
    scoreRole: body.scoreRole ? Number(body.scoreRole) : null,
    scoreSkills: body.scoreSkills ? Number(body.scoreSkills) : null,
    scoreCompany: body.scoreCompany ? Number(body.scoreCompany) : null,
    scoreComp: body.scoreComp ? Number(body.scoreComp) : null,
    scoreGrowth: body.scoreGrowth ? Number(body.scoreGrowth) : null,
    recruiterName: body.recruiterName || null,
    recruiterEmail: body.recruiterEmail || null,
    notes: body.notes || null,
  });

  return Response.json(job, { status: 201, headers: rateLimit.headers });
}

export const GET = GET_handler;
export const POST = POST_handler;
