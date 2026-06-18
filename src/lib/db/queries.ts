import { db } from "./index";
import { jobs, resumes, analyses, settings, scrapeRuns, scrapeResults, jobAnalysis, blsWages } from "./schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import type { NewJob, ScrapeResult } from "./schema";
import type { JobAnalysisResult } from "../ai/analyzeJobs";
import { ensureDb } from "./ensure";
import { getJobIdentityKey, type JobIdentityInput } from "../jobIdentity";

export interface BLSWageData {
  occTitle: string;
  aMedian: number | null;
  aPct25: number | null;
  aPct75: number | null;
  aMean: number | null;
  dataYear: number;
}

export function getBLSWage(socCode: string): BLSWageData | null {
  try {
    const row = getDb().select().from(blsWages).where(eq(blsWages.occCode, socCode)).get();
    if (!row) return null;
    return {
      occTitle: row.occTitle,
      aMedian: row.aMedian ?? null,
      aPct25: row.aPct25 ?? null,
      aPct75: row.aPct75 ?? null,
      aMean: row.aMean ?? null,
      dataYear: row.dataYear ?? 2024,
    };
  } catch {
    return null;
  }
}

export function getBLSStatus(): { count: number; year: number | null } {
  try {
    const row = getDb()
      .select({ count: sql<number>`COUNT(*)`, year: sql<number | null>`MAX(data_year)` })
      .from(blsWages)
      .get();
    return { count: row?.count ?? 0, year: row?.year ?? null };
  } catch {
    return { count: 0, year: null };
  }
}

function getDb() {
  ensureDb();
  return db();
}

// --- Jobs ---

const PROTECTED_FIELDS = new Set(["id", "createdAt", "updatedAt", "scoreTotal"]);

export function getAllJobs() {
  const d = getDb();
  return d
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .all();
}

export function getExistingTrackedJobIdentityKeys(): Set<string> {
  const keys = new Set<string>();
  for (const job of getAllJobs()) {
    const key = getJobIdentityKey(job);
    if (key) keys.add(key);
  }
  return keys;
}

export function findExistingJobByIdentity(input: JobIdentityInput) {
  const key = getJobIdentityKey(input);
  if (!key) return null;

  for (const job of getAllJobs()) {
    if (getJobIdentityKey(job) === key) return job;
  }
  return null;
}

export function getJobById(id: number) {
  const d = getDb();
  return d.select().from(jobs).where(eq(jobs.id, id)).get();
}

export function createJob(data: NewJob) {
  const d = getDb();
  const scores = [data.scoreRole, data.scoreSkills, data.scoreCompany, data.scoreComp, data.scoreGrowth];
  const total = scores.every((s) => s != null)
    ? scores.reduce((a, b) => a! + b!, 0)
    : null;

  return d
    .insert(jobs)
    .values({
      ...data,
      scoreTotal: total,
      dateAdded: new Date().toISOString().split("T")[0],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

export function updateJob(id: number, data: Partial<NewJob>) {
  const d = getDb();
  const existing = getJobById(id);
  if (!existing) return null;

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!PROTECTED_FIELDS.has(k)) clean[k] = v;
  }

  const merged = { ...existing, ...clean };
  const scores = [merged.scoreRole, merged.scoreSkills, merged.scoreCompany, merged.scoreComp, merged.scoreGrowth];
  const total = scores.every((s) => s != null)
    ? scores.reduce((a, b) => a! + b!, 0)
    : null;

  return d
    .update(jobs)
    .set({
      ...clean,
      scoreTotal: total,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id))
    .returning()
    .get();
}

export function deleteJob(id: number) {
  const d = getDb();
  return d.delete(jobs).where(eq(jobs.id, id)).run();
}

// --- Resumes ---

export function getMasterResume() {
  const d = getDb();
  return d
    .select()
    .from(resumes)
    .where(eq(resumes.type, "master"))
    .orderBy(desc(resumes.createdAt))
    .get();
}

export function saveMasterResume(content: string) {
  const d = getDb();
  const existing = getMasterResume();
  if (existing) {
    return d
      .update(resumes)
      .set({ content })
      .where(eq(resumes.id, existing.id))
      .returning()
      .get();
  }
  return d
    .insert(resumes)
    .values({ type: "master", content })
    .returning()
    .get();
}

export function getTailoredResume(jobId: number) {
  const d = getDb();
  return d
    .select()
    .from(resumes)
    .where(eq(resumes.jobId, jobId))
    .orderBy(desc(resumes.createdAt))
    .get();
}

export function saveTailoredResume(jobId: number, content: string) {
  const d = getDb();
  return d
    .insert(resumes)
    .values({ jobId, type: "tailored", content })
    .returning()
    .get();
}

// --- Analyses ---

export function getAnalysis(jobId: number) {
  const d = getDb();
  return d
    .select()
    .from(analyses)
    .where(eq(analyses.jobId, jobId))
    .orderBy(desc(analyses.createdAt))
    .get();
}

export function saveAnalysis(
  jobId: number,
  data: {
    keywords: string[];
    fitScore: number;
    redFlags: string[];
    mustHave: string[];
    niceToHave: string[];
    questions: string[];
    rawResponse: string;
  }
) {
  const d = getDb();
  return d
    .insert(analyses)
    .values({
      jobId,
      keywords: JSON.stringify(data.keywords),
      fitScore: data.fitScore,
      redFlags: JSON.stringify(data.redFlags),
      mustHave: JSON.stringify(data.mustHave),
      niceToHave: JSON.stringify(data.niceToHave),
      questions: JSON.stringify(data.questions),
      rawResponse: data.rawResponse,
    })
    .returning()
    .get();
}

// --- Settings ---

export function getSetting(key: string): string | null {
  const d = getDb();
  const row = d.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  const d = getDb();
  return d
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getAllSettings() {
  const d = getDb();
  const rows = d.select().from(settings).all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value ?? "";
  }
  return result;
}

// --- Scrape Runs ---

export interface ScrapeMetrics {
  avgSalaryMin: number | null;
  avgSalaryMax: number | null;
  hasSalaryCount: number;
  remoteCount: number;
  sourceBreakdown: Record<string, number>;
  jobTypeBreakdown: Record<string, number>;
}

export function computeScrapeMetrics(results: Omit<ScrapeResult, "id" | "scrapeRunId" | "createdAt">[]): ScrapeMetrics {
  let salaryMinSum = 0, salaryMaxSum = 0, hasSalaryCount = 0, remoteCount = 0;
  const sourceBreakdown: Record<string, number> = {};
  const jobTypeBreakdown: Record<string, number> = {};

  for (const r of results) {
    if (r.salaryMin != null && r.salaryMax != null) {
      salaryMinSum += r.salaryMin;
      salaryMaxSum += r.salaryMax;
      hasSalaryCount++;
    }
    if (r.location?.toLowerCase().includes("remote")) remoteCount++;
    if (r.source) sourceBreakdown[r.source] = (sourceBreakdown[r.source] || 0) + 1;
    if (r.jobType) {
      const jt = r.jobType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      jobTypeBreakdown[jt] = (jobTypeBreakdown[jt] || 0) + 1;
    }
  }

  return {
    avgSalaryMin: hasSalaryCount > 0 ? Math.round(salaryMinSum / hasSalaryCount) : null,
    avgSalaryMax: hasSalaryCount > 0 ? Math.round(salaryMaxSum / hasSalaryCount) : null,
    hasSalaryCount,
    remoteCount,
    sourceBreakdown,
    jobTypeBreakdown,
  };
}

export function getExistingScrapeIdentityKeys(): Set<string> {
  const d = getDb();
  const keys = new Set<string>();
  const rows = d
    .select({
      role: scrapeResults.role,
      company: scrapeResults.company,
      location: scrapeResults.location,
      url: scrapeResults.url,
    })
    .from(scrapeResults)
    .all();

  for (const row of rows) {
    const key = getJobIdentityKey(row);
    if (key) keys.add(key);
  }
  return keys;
}

export function saveScrapeRun(
  config: { searches: { term: string; location: string }[]; sites: string[]; results: number; hours: number },
  results: Omit<ScrapeResult, "id" | "scrapeRunId" | "createdAt">[]
): { run: typeof scrapeRuns.$inferSelect; resultIds: number[] } {
  const d = getDb();
  const metrics = computeScrapeMetrics(results);

  const run = d
    .insert(scrapeRuns)
    .values({
      searches: JSON.stringify(config.searches),
      sites: JSON.stringify(config.sites),
      resultsPerSite: config.results,
      hours: config.hours,
      totalFound: results.length,
      metrics: JSON.stringify(metrics),
    })
    .returning()
    .get();

  let resultIds: number[] = [];
  if (results.length > 0) {
    const inserted = d
      .insert(scrapeResults)
      .values(results.map((r) => ({ ...r, scrapeRunId: run.id })))
      .returning({ id: scrapeResults.id })
      .all();
    resultIds = inserted.map((r) => r.id);
  }

  return { run, resultIds };
}

export function saveJobAnalyses(
  resultIds: number[],
  analyses: JobAnalysisResult[]
) {
  if (resultIds.length === 0) return;
  const d = getDb();
  const rows = resultIds
    .map((scrapeResultId, i) => {
      const a = analyses[i];
      if (!a) return null;
      return {
        scrapeResultId,
        rankScore: a.rankScore,
        scorePay: a.scorePay,
        scoreFlexibility: a.scoreFlexibility,
        scoreResponsibilities: a.scoreResponsibilities,
        scoreHours: a.scoreHours,
        scoreRequirements: a.scoreRequirements,
        scoreLocation: a.scoreLocation,
        schedule: JSON.stringify(a.schedule),
        benefits: JSON.stringify(a.benefits),
        notes: a.notes,
        details: JSON.stringify(a.requirements),
        estimatedSalaryMin: a.estimatedSalaryMin,
        estimatedSalaryMax: a.estimatedSalaryMax,
        salaryConfidence: a.salaryConfidence,
        socCode: a.socCode ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    d.insert(jobAnalysis).values(rows).run();
  }
}

export function deleteScrapeRun(id: number) {
  const d = getDb();
  return d.delete(scrapeRuns).where(eq(scrapeRuns.id, id)).run();
}

export function getAllScrapeRuns() {
  const d = getDb();
  return d.select().from(scrapeRuns).orderBy(desc(scrapeRuns.createdAt)).all();
}

export function getScrapeRunById(id: number) {
  const d = getDb();
  return d.select().from(scrapeRuns).where(eq(scrapeRuns.id, id)).get();
}

export function getScrapeResultsByRunId(runId: number) {
  const d = getDb();
  const results = d
    .select()
    .from(scrapeResults)
    .where(eq(scrapeResults.scrapeRunId, runId))
    .all();

  if (results.length === 0) return [];

  const ids = results.map((r) => r.id);
  const analysisRows = d
    .select()
    .from(jobAnalysis)
    .where(inArray(jobAnalysis.scrapeResultId, ids))
    .all();

  const analysisMap = new Map(analysisRows.map((a) => [a.scrapeResultId, a]));

  return results.map((r) => {
    const a = analysisMap.get(r.id);
    if (!a) return { ...r, analysis: null };
    const blsWage = a.socCode ? getBLSWage(a.socCode) : null;
    return {
      ...r,
      analysis: {
        rankScore: a.rankScore,
        scorePay: a.scorePay,
        scoreFlexibility: a.scoreFlexibility,
        scoreLocation: a.scoreLocation ?? 5,
        scoreResponsibilities: a.scoreResponsibilities,
        scoreHours: a.scoreHours,
        scoreRequirements: a.scoreRequirements,
        schedule: a.schedule ? JSON.parse(a.schedule) : null,
        benefits: a.benefits ? JSON.parse(a.benefits) : [],
        notes: a.notes ?? "",
        requirements: a.details ? JSON.parse(a.details) : null,
        estimatedSalaryMin: a.estimatedSalaryMin ?? null,
        estimatedSalaryMax: a.estimatedSalaryMax ?? null,
        salaryConfidence: a.salaryConfidence ?? null,
        socCode: a.socCode ?? null,
        blsWage,
      },
    };
  });
}
