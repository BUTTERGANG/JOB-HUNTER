export interface JobIdentityInput {
  url?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
}

// Tracking/session params that carry no job identity info and should be stripped.
// Identity params like Indeed's `jk` must be kept — they ARE the unique job ID.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "msclkid", "ttclid", "dclid", "ref", "referer",
  "trk", "trkInfo", "trackingId", "sid", "cid", "clickId",
  "WT.mc_id", "mc_eid", "origin", "viewType", "viewId",
]);

export function normalizeJobUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip tracking params but keep identity params (e.g. Indeed's ?jk=...)
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }

    // Sort remaining params for consistency (same job, different param order = same key)
    const remaining = [...parsed.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    parsed.search = remaining.length > 0
      ? "?" + remaining.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
      : "";

    const normalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
    return normalized || null;
  } catch {
    // Fallback for malformed URLs: keep up to (but not including) fragment
    return trimmed.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "") || null;
  }
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getJobIdentityKey(job: JobIdentityInput): string | null {
  const normalizedUrl = normalizeJobUrl(job.url);
  if (normalizedUrl) return `url:${normalizedUrl}`;

  const company = normalizeText(job.company);
  const role = normalizeText(job.role);
  const location = normalizeText(job.location);

  if (!company || !role) return null;
  return `text:${company}|${role}|${location}`;
}
