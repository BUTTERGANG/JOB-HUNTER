import { SITES } from "./constants";

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ScrapeConfigInput {
  searches: { term: string; location: string }[];
  sites: string[];
  results: number;
  hours: number;
  resultsBySite?: Record<string, number>;
}

export function validateScrapeConfig(input: unknown): ValidationResult<ScrapeConfigInput> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid request body: expected object" };
  }

  const body = input as Record<string, unknown>;

  // Validate searches
  if (!Array.isArray(body.searches) || body.searches.length === 0) {
    return { ok: false, error: "searches must be a non-empty array" };
  }

  const searches = body.searches.map((s, i) => {
    if (!s || typeof s !== "object") {
      throw new Error(`searches[${i}] must be an object`);
    }
    const search = s as Record<string, unknown>;
    const term = typeof search.term === "string" ? search.term.trim() : "";
    const location = typeof search.location === "string" ? search.location.trim() : "";
    if (!term && !location) {
      throw new Error(`searches[${i}] must have at least term or location`);
    }
    if (term.length > 200) throw new Error(`searches[${i}].term too long (max 200 chars)`);
    if (location.length > 200) throw new Error(`searches[${i}].location too long (max 200 chars)`);
    return { term, location };
  });

  // Validate sites
  if (!Array.isArray(body.sites) || body.sites.length === 0) {
    return { ok: false, error: "sites must be a non-empty array" };
  }
  const validSiteIds = new Set(SITES.map(s => s.id));
  const sites = body.sites.map((s, i) => {
    if (typeof s !== "string") throw new Error(`sites[${i}] must be a string`);
    if (!validSiteIds.has(s)) throw new Error(`sites[${i}] invalid site: ${s}`);
    return s;
  });

  // Validate results
  const results = Number(body.results);
  if (!Number.isInteger(results) || results < 5 || results > 1000) {
    return { ok: false, error: "results must be an integer between 5 and 1000" };
  }

  // Validate hours
  const hours = Number(body.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 8760) {
    return { ok: false, error: "hours must be an integer between 1 and 8760 (1 year)" };
  }

  // Validate resultsBySite (optional)
  let resultsBySite: Record<string, number> | undefined;
  if (body.resultsBySite) {
    if (typeof body.resultsBySite !== "object") {
      return { ok: false, error: "resultsBySite must be an object" };
    }
    resultsBySite = {};
    for (const [site, val] of Object.entries(body.resultsBySite)) {
      if (!validSiteIds.has(site)) return { ok: false, error: `resultsBySite: invalid site ${site}` };
      const n = Number(val);
      if (!Number.isInteger(n) || n < 5 || n > 1000) {
        return { ok: false, error: `resultsBySite[${site}] must be integer 5-1000` };
      }
      resultsBySite[site] = n;
    }
  }

  return { ok: true, data: { searches, sites, results, hours, resultsBySite } };
}

export function validateBulkScanConfig(input: unknown): ValidationResult<{
  sites: string[];
  resultsBySite: Record<string, number>;
  hours: number;
  term: string;
  broadSearch: boolean;
  concurrency: number;
}> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid request body: expected object" };
  }

  const body = input as Record<string, unknown>;
  const validSiteIds = new Set(SITES.map(s => s.id));

  // sites
  if (!Array.isArray(body.sites) || body.sites.length === 0) {
    return { ok: false, error: "sites must be a non-empty array" };
  }
  const sites = body.sites.map((s, i) => {
    if (typeof s !== "string") throw new Error(`sites[${i}] must be a string`);
    if (!validSiteIds.has(s)) throw new Error(`sites[${i}] invalid site: ${s}`);
    return s;
  });

  // resultsBySite
  if (!body.resultsBySite || typeof body.resultsBySite !== "object") {
    return { ok: false, error: "resultsBySite must be an object" };
  }
  const resultsBySite: Record<string, number> = {};
  for (const [site, val] of Object.entries(body.resultsBySite)) {
    if (!validSiteIds.has(site)) return { ok: false, error: `resultsBySite: invalid site ${site}` };
    const n = Number(val);
    if (!Number.isInteger(n) || n < 5 || n > 1000) {
      return { ok: false, error: `resultsBySite[${site}] must be integer 5-1000` };
    }
    resultsBySite[site] = n;
  }
  // Ensure all selected sites have a cap
  for (const site of sites) {
    if (!(site in resultsBySite)) return { ok: false, error: `resultsBySite missing cap for site: ${site}` };
  }

  // hours
  const hours = Number(body.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 8760) {
    return { ok: false, error: "hours must be an integer between 1 and 8760" };
  }

  // term
  const term = typeof body.term === "string" ? body.term.trim() : "";
  if (term.length > 200) return { ok: false, error: "term too long (max 200 chars)" };

  // broadSearch
  const broadSearch = Boolean(body.broadSearch);

  // concurrency
  const concurrency = Number(body.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    return { ok: false, error: "concurrency must be an integer between 1 and 16" };
  }

  return { ok: true, data: { sites, resultsBySite, hours, term, broadSearch, concurrency } };
}

export function validateTailorRequest(input: unknown): ValidationResult<{ description: string; jobId?: number }> {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request body" };
  const body = input as Record<string, unknown>;

  if (typeof body.description !== "string") return { ok: false, error: "description is required" };
  if (body.description.length > 50000) return { ok: false, error: "description too long (max 50000 chars)" };

  const jobId = body.jobId !== undefined ? Number(body.jobId) : undefined;
  if (jobId !== undefined && (!Number.isInteger(jobId) || jobId < 1)) {
    return { ok: false, error: "jobId must be a positive integer" };
  }

  return { ok: true, data: { description: body.description, jobId } };
}

export function validateAnalyzeRequest(input: unknown): ValidationResult<{ description: string; jobId?: number }> {
  return validateTailorRequest(input); // Same validation
}

export function validateSettingsUpdate(input: unknown): ValidationResult<Record<string, string>> {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request body" };
  const body = input as Record<string, unknown>;

  const allowedKeys = [
    "user_name", "target_salary_floor", "target_salary_target", "target_salary_stretch",
    "masterResume", "schedule_searches", "schedule_sites", "schedule_results",
    "schedule_hours", "discord_notifications_enabled", "discord_webhook_url",
    "discord_min_score", "discord_max_jobs", "scrape_dedupe_enabled",
    "scrape_proxies", "scrape_proxy_sessions", "anthropic_api_key"
  ];

  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(body)) {
    if (!allowedKeys.includes(key)) {
      return { ok: false, error: `Invalid setting key: ${key}` };
    }
    if (val !== undefined && val !== null) {
      result[key] = String(val);
    }
  }
  return { ok: true, data: result };
}