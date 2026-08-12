import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateJob, getSetting } from "@/lib/db/queries";
import { fetchJobPageText, extractJobInput } from "@/lib/ai/extractJobFromUrl";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

// Backfill a tracked job's description by fetching its posting URL and extracting
// the text with the same fetcher the Analyze feature uses. Sites that block
// server-side fetches (Indeed/Glassdoor) return 409 needsManual so the UI can
// prompt for a manual paste.
async function POST_handler(
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
  const job = getJobById(Number(id));
  if (!job) return Response.json({ error: "Job not found" }, { status: 404, headers: rateLimit.headers });
  if (!job.url) {
    return Response.json(
      { error: "This job has no URL to fetch from. Paste the description manually." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const apiKey = getSetting("anthropic_api_key");
  if (!apiKey) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings to add it." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const proxyRaw = getSetting("scrape_proxies");
  const proxy = proxyRaw
    ? proxyRaw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)[0] ?? null
    : null;

  const fetched = await fetchJobPageText(job.url, { proxy });
  if (!fetched.ok) {
    return Response.json(
      {
        error: `${fetched.error ?? "Could not read that page."} Paste the job description manually below.`,
        needsManual: true,
      },
      { status: 409, headers: rateLimit.headers }
    );
  }

  let extracted;
  try {
    extracted = await extractJobInput(fetched.text, apiKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Could not extract the description: ${msg}` }, { status: 502, headers: rateLimit.headers });
  }

  if (!extracted.description || extracted.description.trim().length < 50) {
    return Response.json(
      {
        error: "Fetched the page but couldn't pull a usable description. Paste it manually below.",
        needsManual: true,
      },
      { status: 409, headers: rateLimit.headers }
    );
  }

  // Backfill the company too when it's missing/placeholder and extraction found one.
  const companyMissing = !job.company || job.company.trim() === "" || job.company === "Unknown company";
  const patch: { description: string; company?: string } = { description: extracted.description };
  if (companyMissing && extracted.company) patch.company = extracted.company;

  const updated = updateJob(Number(id), patch);
  return Response.json({
    description: updated?.description ?? extracted.description,
    company: updated?.company ?? job.company,
  }, { headers: rateLimit.headers });
}

export const POST = POST_handler;
