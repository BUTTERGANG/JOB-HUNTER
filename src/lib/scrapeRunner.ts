import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import Papa from "papaparse";
import { saveScrapeRun, saveJobAnalyses, getSetting, getBLSWage, getExistingScrapeIdentityKeys } from "@/lib/db/queries";
import type { BLSWageData } from "@/lib/db/queries";
import { analyzeJobsBatch } from "@/lib/ai/analyzeJobs";
import type { JobAnalysisResult } from "@/lib/ai/analyzeJobs";
import { getJobIdentityKey } from "@/lib/jobIdentity";

const exec = promisify(execFile);

export interface ScrapeConfig {
  searches: { term: string; location: string }[];
  sites: string[];
  results: number;
  hours: number;
  /** Optional per-site result caps (e.g. { indeed: 300, linkedin: 75 }); falls back to `results`. */
  resultsBySite?: Record<string, number>;
}

export interface ScrapedJobWithAnalysis {
  role: string;
  company: string;
  location: string | null;
  url: string | null;
  source: string | null;
  description: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  datePosted: string | null;
  jobType: string | null;
  analysis: (JobAnalysisResult & { blsWage: BLSWageData | null }) | null;
}

function parseSalary(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

export interface ScrapeDedupeResult {
  inputCount: number;
  withinRunDuplicates: number;
  previousRunDuplicates: number;
  outputCount: number;
}

export interface SiteStatus {
  site: string;
  /** Total rows the scraper reported for this site across all searches. */
  results: number;
  /** Number of searches where this site threw (timeout, parse error, etc.). */
  failures: number;
  /** Distinct error messages collected for this site. */
  errors: string[];
  /** True if JobSpy logged a 429 / "Blocked" for this site. */
  blocked: boolean;
}

/**
 * Parse the per-site progress lines that scrape_jobs.py prints to stderr.
 * The script emits, per (search, site):
 *   "  [linkedin] term @ loc"        ← site marker
 *   "    → 12 results"               ← success for the marker above
 *   "    ✗ linkedin failed: <msg>"   ← failure for the marker above
 * JobSpy's own logger may also emit "429 Response - Blocked by LinkedIn ...".
 */
export function parseSiteStatus(stderr: string): SiteStatus[] {
  const map = new Map<string, SiteStatus>();
  const get = (site: string): SiteStatus => {
    const key = site.toLowerCase();
    let s = map.get(key);
    if (!s) {
      s = { site: key, results: 0, failures: 0, errors: [], blocked: false };
      map.set(key, s);
    }
    return s;
  };

  let currentSite: string | null = null;
  for (const raw of stderr.split("\n")) {
    const line = raw.trimEnd();

    const marker = line.match(/^\s*\[([a-z_]+)\]/i);
    if (marker) {
      currentSite = marker[1];
      get(currentSite); // ensure the site shows up even if it returns nothing
      continue;
    }

    const ok = line.match(/→\s*(\d+)\s+results/);
    if (ok && currentSite) {
      get(currentSite).results += Number(ok[1]);
      continue;
    }

    const failed = line.match(/✗\s*([a-z_]+)\s+failed:\s*(.*)$/i);
    if (failed) {
      const s = get(failed[1]);
      s.failures += 1;
      const msg = failed[2].trim().slice(0, 200);
      if (msg && !s.errors.includes(msg)) s.errors.push(msg);
      continue;
    }

    // JobSpy internal block/rate-limit logs (not tied to a marker line).
    if (/429|blocked by/i.test(line)) {
      const which = line.match(/\b(linkedin|indeed|glassdoor|zip_?recruiter|google)\b/i);
      if (which) get(which[1].replace(/zip\s?recruiter/i, "zip_recruiter")).blocked = true;
      else if (currentSite) get(currentSite).blocked = true;
    }
  }

  return [...map.values()];
}

/**
 * Expand proxy lines into a rotation pool. A DataImpulse credential is fanned out
 * into `sessions` sticky-session variants (`;sessid.<runId>_<n>;sessttl.10` injected
 * after the username) so JobSpy round-robins across several stable residential IPs —
 * keeping LinkedIn's ~10-pages-per-IP limit well out of reach. Non-DataImpulse lines
 * (and lines that already pin a session) pass through unchanged.
 */
export function expandProxies(lines: string[], sessions: number, runId: number | string): string[] {
  const out: string[] = [];
  const n = Math.max(1, Math.floor(sessions) || 1);
  for (const line of lines) {
    const colon = line.indexOf(":");
    const isDataImpulse = /dataimpulse/i.test(line) && !/sessid/i.test(line);
    if (isDataImpulse && n > 1 && colon > 0) {
      const user = line.slice(0, colon);
      const rest = line.slice(colon); // ":pass@host:port"
      for (let i = 1; i <= n; i++) {
        out.push(`${user};sessid.${runId}_${i};sessttl.10${rest}`);
      }
    } else {
      out.push(line);
    }
  }
  return out;
}

export async function runScrapeAndAnalyze(
  config: ScrapeConfig,
  opts?: { timeoutMs?: number; skipAnalysis?: boolean; skipDedupe?: boolean }
): Promise<{
  jobs: ScrapedJobWithAnalysis[];
  count: number;
  dedupe?: ScrapeDedupeResult;
  siteStatus?: SiteStatus[];
  error?: string;
  /** Non-fatal warning surfaced to the client, e.g. the jobs were scraped but not persisted. */
  saveWarning?: string;
}> {
  // Unique per call (not just Date.now) so concurrent bulk states never collide on
  // temp-file paths, and each gets distinct proxy session ids → fresh IPs.
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const configPath = join(tmpdir(), `jobspy_config_${id}.json`);
  const outPath = join(tmpdir(), `jobspy_out_${id}.csv`);
  const scriptPath = resolve(process.cwd(), "scripts/scrape_jobs.py");
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const skipAnalysis = opts?.skipAnalysis ?? false;
  const skipDedupe = opts?.skipDedupe ?? false;

  // Skip the expensive per-job LinkedIn description fetch when we won't analyze
  // descriptions anyway (bulk market scans). This is the biggest timeout driver.
  // Proxies (optional, one per line in settings) are round-robined by JobSpy and
  // are the real fix for single-IP rate limiting on LinkedIn/Indeed.
  const proxyRaw = getSetting("scrape_proxies");
  const proxyLines = proxyRaw
    ? proxyRaw.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)
    : [];
  const sessionCount = Number(getSetting("scrape_proxy_sessions")) || 8;
  // `id` (Date.now) seeds the session ids so every state/retry draws fresh IPs.
  const proxies = expandProxies(proxyLines, sessionCount, id);
  // When a search term is empty, Google's query becomes " jobs near {loc}" — a
  // leading-space, no-keyword query that Google returns 0 results for. JobSpy
  // supports a per-call google_search_term override; set it to "jobs" so the
  // Google query is "jobs near {loc}" instead. Indeed handles empty terms
  // correctly (omits the `what` clause), so this only matters for Google.
  const hasEmptyTerm = config.searches.some((s) => !s.term.trim());
  const pyConfig = {
    ...config,
    fetch_descriptions: !skipAnalysis,
    ...(config.resultsBySite ? { results_by_site: config.resultsBySite } : {}),
    ...(proxies.length ? { proxies } : {}),
    ...(hasEmptyTerm ? { google_search_term: "jobs" } : {}),
  };
  await writeFile(configPath, JSON.stringify(pyConfig));

  let stderr = "";
  try {
    const r = await exec("python3", [scriptPath, "--config", configPath, "--out", outPath], {
      timeout: timeoutMs,
      // JobSpy with verbose logging can emit a lot of stderr; the default 1MB
      // buffer would otherwise overflow and surface as a (false) scrape failure.
      // Cap at 16MB to prevent OOM - if exceeded, we'll truncate and still
      // attempt to parse what we captured.
      maxBuffer: 16 * 1024 * 1024,
    });
    stderr = r.stderr ?? "";
    // Safety: if stderr somehow exceeded maxBuffer, it would have thrown.
    // But let's also guard against pathological cases by truncating if needed.
    if (stderr.length > 16 * 1024 * 1024) {
      stderr = stderr.slice(-16 * 1024 * 1024);
    }
  } catch (err: unknown) {
    await unlink(configPath).catch(() => {});
    // execFile attaches whatever stderr was captured before the kill/timeout —
    // keep it so timeouts still report which site was being processed.
    const e = err as { stderr?: string; message?: string };
    stderr = e.stderr ?? "";
    const msg = err instanceof Error ? err.message : String(err);
    return {
      jobs: [],
      count: 0,
      siteStatus: parseSiteStatus(stderr),
      error: msg.includes("python-jobspy not installed")
        ? "python-jobspy is not installed. Run: pip install -U python-jobspy"
        : `Scrape failed: ${msg}`,
    };
  }

  await unlink(configPath).catch(() => {});
  const siteStatus = parseSiteStatus(stderr);

  let csv: string;
  try {
    csv = await readFile(outPath, "utf-8");
    await unlink(outPath).catch(() => {});
  } catch {
    return { jobs: [], count: 0, siteStatus, error: "Scraper produced no output file" };
  }

  const { data } = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  let jobs = data.map((row) => ({
    role: row["Title"] || "",
    company: row["Company"] || "",
    location: row["Location"] || null,
    url: row["Job URL"] || null,
    source: row["Source"] || null,
    description: row["Description"] || null,
    salaryMin: parseSalary(row["Salary Min"]),
    salaryMax: parseSalary(row["Salary Max"]),
    datePosted: row["Date Posted"] || null,
    jobType: row["Job Type"] || null,
  }));

  const dedupe: ScrapeDedupeResult = {
    inputCount: jobs.length,
    withinRunDuplicates: 0,
    previousRunDuplicates: 0,
    outputCount: jobs.length,
  };

  const seenThisRun = new Set<string>();
  const previousKeys = skipDedupe || getSetting("scrape_dedupe_enabled") === "false"
    ? new Set<string>()
    : getExistingScrapeIdentityKeys();

  jobs = jobs.filter((job) => {
    const key = getJobIdentityKey(job);
    if (!key) return true;
    if (seenThisRun.has(key)) {
      dedupe.withinRunDuplicates++;
      return false;
    }
    seenThisRun.add(key);
    if (previousKeys.has(key)) {
      dedupe.previousRunDuplicates++;
      return false;
    }
    return true;
  });
  dedupe.outputCount = jobs.length;

  let resultIds: number[] = [];
  let saveWarning: string | undefined;
  try {
    const saved = saveScrapeRun(
      {
        searches: config.searches,
        sites: config.sites,
        results: config.results,
        hours: config.hours,
      },
      jobs.map((job) => ({
        role: job.role,
        company: job.company,
        location: job.location,
        url: job.url,
        source: job.source,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        datePosted: job.datePosted,
        jobType: job.jobType,
        description: job.description,
      }))
    );
    resultIds = saved.resultIds;
  } catch (e) {
    // The scrape itself succeeded, but persistence failed — surface it rather
    // than reporting a clean success while silently dropping the data.
    console.error("saveScrapeRun failed:", e);
    saveWarning =
      "Jobs were scraped but could not be saved to the database — this run won't appear in history and results were not persisted.";
  }

  let analyses: JobAnalysisResult[] = [];
  if (!skipAnalysis) {
    const apiKey = getSetting("anthropic_api_key");
    if (apiKey && jobs.length > 0 && resultIds.length === jobs.length) {
      try {
        analyses = await analyzeJobsBatch(jobs, apiKey);
        saveJobAnalyses(resultIds, analyses);
      } catch {
        // Non-fatal — return jobs without analysis
      }
    }
  }

  const jobsWithAnalysis: ScrapedJobWithAnalysis[] = jobs.map((j, i) => {
    const ana = analyses[i] ?? null;
    const blsWage = ana?.socCode ? getBLSWage(ana.socCode) : null;
    return { ...j, analysis: ana ? { ...ana, blsWage } : null };
  });

  return { jobs: jobsWithAnalysis, count: jobsWithAnalysis.length, dedupe, siteStatus, saveWarning };
}
