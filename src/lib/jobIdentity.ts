export interface JobIdentityInput {
  url?: string | null;
  company?: string | null;
  role?: string | null;
  location?: string | null;
}

export function normalizeJobUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    const normalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    return normalized || null;
  } catch {
    return trimmed.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "") || null;
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
