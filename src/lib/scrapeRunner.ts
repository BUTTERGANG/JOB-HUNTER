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

export async function runScrapeAndAnalyze(
  config: ScrapeConfig,
  opts?: { timeoutMs?: number; skipAnalysis?: boolean; skipDedupe?: boolean }
): Promise<{
  jobs: ScrapedJobWithAnalysis[];
  count: number;
  dedupe?: ScrapeDedupeResult;
  error?: string;
}> {
  const id = Date.now();
  const configPath = join(tmpdir(), `jobspy_config_${id}.json`);
  const outPath = join(tmpdir(), `jobspy_out_${id}.csv`);
  const scriptPath = resolve(process.cwd(), "scripts/scrape_jobs.py");
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const skipAnalysis = opts?.skipAnalysis ?? false;
  const skipDedupe = opts?.skipDedupe ?? false;

  await writeFile(configPath, JSON.stringify(config));

  try {
    await exec("python3", [scriptPath, "--config", configPath, "--out", outPath], {
      timeout: timeoutMs,
    });
  } catch (err: unknown) {
    await unlink(configPath).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return {
      jobs: [],
      count: 0,
      error: msg.includes("python-jobspy not installed")
        ? "python-jobspy is not installed. Run: pip install -U python-jobspy"
        : `Scrape failed: ${msg}`,
    };
  }

  await unlink(configPath).catch(() => {});

  let csv: string;
  try {
    csv = await readFile(outPath, "utf-8");
    await unlink(outPath).catch(() => {});
  } catch {
    return { jobs: [], count: 0, error: "Scraper produced no output file" };
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
      }))
    );
    resultIds = saved.resultIds;
  } catch {
    // Non-fatal — continue without DB save
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

  return { jobs: jobsWithAnalysis, count: jobsWithAnalysis.length, dedupe };
}
