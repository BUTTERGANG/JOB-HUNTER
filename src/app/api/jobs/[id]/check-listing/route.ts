import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateJob, getSetting, recordListingStatusCheck } from "@/lib/db/queries";
import { checkListingAvailability } from "@/lib/listingAvailability";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function POST_handler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      { error: "This job has no URL to check." },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const proxyRaw = getSetting("scrape_proxies");
  const proxy = proxyRaw
    ? proxyRaw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)[0] ?? null
    : null;

  const { status, checkedAt } = await checkListingAvailability(job.url, { proxy });
  const updated = updateJob(Number(id), { listingStatus: status, listingCheckedAt: checkedAt });
  recordListingStatusCheck(Number(id), status, checkedAt);

  return Response.json({
    listingStatus: updated?.listingStatus ?? status,
    listingCheckedAt: updated?.listingCheckedAt ?? checkedAt,
  }, { headers: rateLimit.headers });
}

export const POST = POST_handler;
