import { NextRequest, NextResponse } from "next/server";
import { getAllJobs, updateJob, getSetting, recordListingStatusCheck } from "@/lib/db/queries";
import { checkListingAvailability } from "@/lib/listingAvailability";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

// Sequential/synchronous by design: the current dataset is small (tens of
// jobs), so a single request round-trip is fine. If the job count grows large
// enough to risk hitting a request timeout, move this to the async
// bulk_runs-style run-tracking pattern used by the scraper instead.
async function POST_handler(request: NextRequest) {
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const proxyRaw = getSetting("scrape_proxies");
  const proxy = proxyRaw
    ? proxyRaw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)[0] ?? null
    : null;

  const jobsWithUrl = getAllJobs().filter((j) => j.url);

  let active = 0;
  let expired = 0;
  let unknown = 0;

  for (const job of jobsWithUrl) {
    const { status, checkedAt } = await checkListingAvailability(job.url!, { proxy });
    updateJob(job.id, { listingStatus: status, listingCheckedAt: checkedAt });
    recordListingStatusCheck(job.id, status, checkedAt);
    if (status === "active") active++;
    else if (status === "expired") expired++;
    else unknown++;
    await new Promise((r) => setTimeout(r, 300));
  }

  return Response.json(
    { checked: jobsWithUrl.length, active, expired, unknown },
    { headers: rateLimit.headers }
  );
}

export const POST = POST_handler;
