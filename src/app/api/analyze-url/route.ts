import { NextRequest, NextResponse } from "next/server";
import { getSetting, getBLSWage } from "@/lib/db/queries";
import { analyzeJobsBatch } from "@/lib/ai/analyzeJobs";
import { fetchJobPageText, extractJobInput, sourceFromUrl } from "@/lib/ai/extractJobFromUrl";
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

  const body = await request.json().catch(() => ({}));
  const url: string | null = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  const description: string | null =
    typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  if (!url && !description) {
    return Response.json({ error: "Provide a job URL or paste a job description." }, { status: 400, headers: rateLimit.headers });
  }
  if (url && !description) {
    try {
      new URL(url);
    } catch {
      return Response.json({ error: "That doesn't look like a valid URL." }, { status: 400, headers: rateLimit.headers });
    }
  }

  const apiKey = getSetting("anthropic_api_key");
  if (!apiKey) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings to add it." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  // Manual paste takes precedence; otherwise fetch the page. A blocked/thin fetch
  // returns 409 so the UI can reveal the manual-paste box.
  let content = description;
  if (!content && url) {
    // Reuse the DataImpulse residential proxy the scraper is configured with (if any)
    // as a fallback for sites that block direct fetches.
    const proxyRaw = getSetting("scrape_proxies");
    const proxy = proxyRaw
      ? proxyRaw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)[0] ?? null
      : null;
    const fetched = await fetchJobPageText(url, { proxy });
    if (!fetched.ok) {
      return Response.json(
        {
          error: `${fetched.error ?? "Could not read that page."} Paste the job description below and try again.`,
          needsManual: true,
        },
        { status: 409, headers: rateLimit.headers }
      );
    }
    content = fetched.text;
  }

  let jobInput;
  try {
    jobInput = await extractJobInput(content!, apiKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Could not extract job details: ${msg}` }, { status: 502, headers: rateLimit.headers });
  }

  if (!jobInput.role && !jobInput.company) {
    return Response.json(
      {
        error: "That didn't look like a job posting. Paste the job description text and try again.",
        needsManual: true,
      },
      { status: 409, headers: rateLimit.headers }
    );
  }

  let analysis;
  try {
    const [result] = await analyzeJobsBatch([jobInput], apiKey);
    const blsWage = result?.socCode ? getBLSWage(result.socCode) : null;
    analysis = result ? { ...result, blsWage } : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `AI analysis failed: ${msg}` }, { status: 502, headers: rateLimit.headers });
  }

  const source = sourceFromUrl(url);

  return Response.json({
    job: {
      role: jobInput.role,
      company: jobInput.company,
      location: jobInput.location,
      url,
      source,
      salaryMin: jobInput.salaryMin,
      salaryMax: jobInput.salaryMax,
      jobType: jobInput.jobType,
      description: jobInput.description,
    },
    analysis,
  }, { headers: rateLimit.headers });
}

// Export the auth-wrapped handler for Next.js
export const POST = POST_handler;
