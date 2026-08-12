import { fetchJobPageText } from "./ai/extractJobFromUrl";

export type ListingStatus = "active" | "expired" | "unknown";

const EXPIRED_PHRASES = [
  "no longer accepting applications",
  "this job is no longer available",
  "job posting has expired",
  "this position has been filled",
  "posting has closed",
  "job has been closed",
];

export async function checkListingAvailability(
  url: string,
  opts?: { proxy?: string | null }
): Promise<{ status: ListingStatus; checkedAt: string }> {
  const fetched = await fetchJobPageText(url, opts);
  const checkedAt = new Date().toISOString();
  if (!fetched.ok) return { status: "unknown", checkedAt };
  const text = fetched.text.toLowerCase();
  const expired = EXPIRED_PHRASES.some((p) => text.includes(p));
  return { status: expired ? "expired" : "active", checkedAt };
}
