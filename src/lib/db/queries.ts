import { db } from "./index";
import { jobs, resumes, analyses, settings, scrapeRuns, scrapeResults, jobAnalysis, blsWages, bulkRuns, analysisRuns, govScrapeRuns, govScrapeResults, listingStatusHistory, jobSteps, jobStageEvents } from "./schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import type { NewJob, NewJobStep, ScrapeResult, BulkRunRow, AnalysisRunRow, GovScrapeResult } from "./schema";
import type { JobAnalysisResult } from "../ai/analyzeJobs";
import { ensureDb } from "./ensure";
import { getJobIdentityKey, normalizeJobUrl, type JobIdentityInput } from "../jobIdentity";
import { parseTargetProfile, PROFILE_SETTING_KEY, type TargetProfile } from "../profile";
import { computePipelineMetrics, proposeNextStep } from "../pipeline";
import { interestHits } from "../match";
import { candidateFromResumeRow, recommendResume, type ResumeCandidate } from "../resumeMatch";
import { parseJsonStringArray } from "../json";

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

  const created = d
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

  // Start the history at creation. A job imported already at 'applied' gets that as its
  // first event, so it is never treated as having been sitting at 'saved'.
  if (created) {
    recordStageEvent(created.id, null, created.status, "import");
    ensureNextStep(created.id);
  }

  return created;
}

export function updateJob(id: number, data: Partial<NewJob>) {
  const d = getDb();
  const existing = getJobById(id);
  if (!existing) return null;

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!PROTECTED_FIELDS.has(k)) clean[k] = v;
  }

  // Moving into 'applied' is the one transition we can date for you, and the metrics
  // depend on it: without a date_applied there is no "days to first response".
  if (clean.status === "applied" && !existing.dateApplied && !clean.dateApplied) {
    clean.dateApplied = new Date().toISOString().slice(0, 10);
  }

  const merged = { ...existing, ...clean };
  const scores = [merged.scoreRole, merged.scoreSkills, merged.scoreCompany, merged.scoreComp, merged.scoreGrowth];
  const total = scores.every((s) => s != null)
    ? scores.reduce((a, b) => a! + b!, 0)
    : null;

  const updated = d
    .update(jobs)
    .set({
      ...clean,
      scoreTotal: total,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id))
    .returning()
    .get();

  // Record the transition and line up the next step. Done here rather than in the API
  // route so that every path which changes a status — the UI, the import, a future
  // automation — produces the same history. A status change that silently skipped the
  // log would make "how far did I get" quietly wrong, which is the whole point.
  if (updated && clean.status && clean.status !== existing.status) {
    recordStageEvent(id, existing.status, clean.status as string, "manual");
    ensureNextStep(id);
  }

  return updated;
}

// ── Next steps ──────────────────────────────────────────────────────────────

export function getJobSteps(jobId: number) {
  const d = getDb();
  return d
    .select()
    .from(jobSteps)
    .where(eq(jobSteps.jobId, jobId))
    .orderBy(desc(jobSteps.createdAt))
    .all();
}

/** Every open step, with enough job context to render without a second query. */
export function getOpenSteps() {
  const d = getDb();
  const rows = d
    .select({
      id: jobSteps.id,
      jobId: jobSteps.jobId,
      label: jobSteps.label,
      detail: jobSteps.detail,
      dueDate: jobSteps.dueDate,
      createdAt: jobSteps.createdAt,
      company: jobs.company,
      role: jobs.role,
      status: jobs.status,
      url: jobs.url,
    })
    .from(jobSteps)
    .innerJoin(jobs, eq(jobs.id, jobSteps.jobId))
    .where(sql`${jobSteps.completedAt} IS NULL`)
    .all();

  // Overdue first, then soonest due, then oldest — the order you should work them in.
  const today = new Date().toISOString().slice(0, 10);
  return rows.sort((a, b) => {
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    const aOver = aDue < today ? 0 : 1;
    const bOver = bDue < today ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

export function addJobStep(data: NewJobStep) {
  const d = getDb();
  return d.insert(jobSteps).values(data).returning().get();
}

/**
 * Tick a step off.
 *
 * Completing an "Apply" step also moves the job to 'applied' — that is what ticking it
 * off means, and doing it here keeps the status, the date and the metrics consistent
 * without asking for the same information twice.
 */
export function completeJobStep(stepId: number) {
  const d = getDb();
  const step = d.select().from(jobSteps).where(eq(jobSteps.id, stepId)).get();
  if (!step) return null;

  const now = new Date().toISOString();
  const done = d
    .update(jobSteps)
    .set({ completedAt: now })
    .where(eq(jobSteps.id, stepId))
    .returning()
    .get();

  const job = getJobById(step.jobId);
  if (job && /^apply$/i.test(step.label.trim()) && job.status === "saved") {
    updateJob(job.id, { status: "applied" });
  } else {
    ensureNextStep(step.jobId);
  }

  return done;
}

export function reopenJobStep(stepId: number) {
  const d = getDb();
  return d
    .update(jobSteps)
    .set({ completedAt: null })
    .where(eq(jobSteps.id, stepId))
    .returning()
    .get();
}

export function deleteJobStep(stepId: number) {
  const d = getDb();
  return d.delete(jobSteps).where(eq(jobSteps.id, stepId)).run();
}

/**
 * Make sure the job has an open step, proposing one from its status if it has none.
 *
 * Idempotent: calling it repeatedly never stacks duplicate steps. Terminal outcomes
 * propose nothing, so a closed pipeline stops appearing in the queue.
 */
export function ensureNextStep(jobId: number): void {
  const job = getJobById(jobId);
  if (!job) return;

  const open = getJobSteps(jobId).filter((s) => s.completedAt === null);
  if (open.length > 0) return;

  const suggestion = proposeNextStep({
    status: job.status,
    dateApplied: job.dateApplied,
    followUpDate: job.followUpDate,
  });
  if (!suggestion) return;

  addJobStep({
    jobId,
    label: suggestion.label,
    detail: suggestion.detail,
    dueDate: suggestion.dueDate,
  });
}

// ── Stage history ───────────────────────────────────────────────────────────

export function recordStageEvent(
  jobId: number,
  fromStatus: string | null,
  toStatus: string,
  source: "manual" | "import" | "system" = "manual",
  note?: string
) {
  const d = getDb();
  return d
    .insert(jobStageEvents)
    .values({ jobId, fromStatus, toStatus, source, note, occurredAt: new Date().toISOString() })
    .run();
}

export function getJobStageEvents(jobId: number) {
  const d = getDb();
  return d
    .select()
    .from(jobStageEvents)
    .where(eq(jobStageEvents.jobId, jobId))
    .orderBy(jobStageEvents.occurredAt)
    .all();
}

export function getAllStageEvents() {
  const d = getDb();
  return d.select().from(jobStageEvents).orderBy(jobStageEvents.occurredAt).all();
}

/** Everything the progress view needs, in one place. */
export function getPipelineMetrics() {
  const d = getDb();
  const allJobs = d
    .select({
      id: jobs.id,
      company: jobs.company,
      role: jobs.role,
      status: jobs.status,
      dateApplied: jobs.dateApplied,
      followUpDate: jobs.followUpDate,
    })
    .from(jobs)
    .all();

  const events = d
    .select({
      jobId: jobStageEvents.jobId,
      fromStatus: jobStageEvents.fromStatus,
      toStatus: jobStageEvents.toStatus,
      occurredAt: jobStageEvents.occurredAt,
    })
    .from(jobStageEvents)
    .all();

  return computePipelineMetrics(allJobs, events);
}


export function deleteJob(id: number) {
  const d = getDb();
  return d.delete(jobs).where(eq(jobs.id, id)).run();
}

export function recordListingStatusCheck(jobId: number, status: string, checkedAt: string) {
  const d = getDb();
  return d.insert(listingStatusHistory).values({ jobId, status, checkedAt }).run();
}

export function getListingStatusHistory(jobId: number) {
  const d = getDb();
  return d
    .select()
    .from(listingStatusHistory)
    .where(eq(listingStatusHistory.jobId, jobId))
    .orderBy(desc(listingStatusHistory.checkedAt))
    .all();
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

export interface ResumeMeta {
  label?: string | null;
  roleTitle?: string | null;
  keywords?: string[] | null;
  type?: "tailored" | "reused";
  sourceResumeId?: number | null;
}

export function saveTailoredResume(jobId: number, content: string, meta: ResumeMeta = {}) {
  const d = getDb();
  return d
    .insert(resumes)
    .values({
      jobId,
      type: meta.type ?? "tailored",
      content,
      label: meta.label ?? null,
      roleTitle: meta.roleTitle ?? null,
      keywords: meta.keywords ? JSON.stringify(meta.keywords) : null,
      sourceResumeId: meta.sourceResumeId ?? null,
      reuseCount: 0,
    })
    .returning()
    .get();
}

// ── Resume arsenal ──────────────────────────────────────────────────────────

/** Every resume in the arsenal, newest first, with the job it was built for. */
export function listResumes() {
  const d = getDb();
  const rows = d
    .select({
      id: resumes.id,
      jobId: resumes.jobId,
      type: resumes.type,
      label: resumes.label,
      roleTitle: resumes.roleTitle,
      keywords: resumes.keywords,
      sourceResumeId: resumes.sourceResumeId,
      reuseCount: resumes.reuseCount,
      createdAt: resumes.createdAt,
      chars: sql<number>`length(${resumes.content})`,
      company: jobs.company,
      jobRole: jobs.role,
    })
    .from(resumes)
    .leftJoin(jobs, eq(jobs.id, resumes.jobId))
    .orderBy(desc(resumes.createdAt))
    .all();

  // Derive a display name for rows that predate the label column, so the arsenal never
  // shows a bare id. Stored labels still win — this is only a fallback.
  return rows.map((row) => ({
    ...row,
    label:
      row.label ??
      (row.type === "master"
        ? "Master resume"
        : row.jobRole && row.company
          ? `${row.jobRole} — ${row.company}`
          : `Resume #${row.id}`),
  }));
}

export function getResumeById(id: number) {
  const d = getDb();
  return d.select().from(resumes).where(eq(resumes.id, id)).get();
}

/**
 * Overwrite a resume's content in place.
 *
 * Hand-editing used to call saveTailoredResume, which INSERTS — so every edit added another
 * row to the arsenal, and the new row lost its label, role title, keywords and (for a reused
 * resume) its provenance. Editing now updates the row that is actually attached to the job.
 */
export function updateResumeContent(id: number, content: string) {
  const d = getDb();
  return d.update(resumes).set({ content }).where(eq(resumes.id, id)).returning().get();
}

export function renameResume(id: number, label: string) {
  const d = getDb();
  return d.update(resumes).set({ label }).where(eq(resumes.id, id)).returning().get();
}

/**
 * Best-ranked listings that do not have a resume yet and are not already tracked.
 *
 * The point of the batch is to cover the top of the list, so they come back score-ordered.
 * Already-tracked listings are excluded because they already have a next step and possibly a
 * resume — re-importing them would duplicate the pipeline and reset their history.
 */
export function getResumeBatchCandidates(minScore: number, limit: number) {
  const d = getDb();

  const trackedUrls = new Set(
    d
      .select({ url: jobs.url })
      .from(jobs)
      .all()
      .map((row) => normalizeJobUrl(row.url))
      .filter((key): key is string => Boolean(key))
  );

  const rows = d
    .select({
      scrapeResultId: jobAnalysis.scrapeResultId,
      rankScore: jobAnalysis.rankScore,
      role: scrapeResults.role,
      company: scrapeResults.company,
      location: scrapeResults.location,
      url: scrapeResults.url,
      description: scrapeResults.description,
      salaryMin: scrapeResults.salaryMin,
      salaryMax: scrapeResults.salaryMax,
      source: scrapeResults.source,
      salaryInterval: scrapeResults.salaryInterval,
      scoreInterest: jobAnalysis.scoreInterest,
      scorePay: jobAnalysis.scorePay,
    })
    .from(jobAnalysis)
    .innerJoin(scrapeResults, eq(scrapeResults.id, jobAnalysis.scrapeResultId))
    .where(sql`${jobAnalysis.rankScore} >= ${minScore}`)
    .orderBy(desc(jobAnalysis.rankScore))
    .all();

  return rows
    .filter((row) => {
      const key = normalizeJobUrl(row.url);
      return !(key && trackedUrls.has(key));
    })
    .slice(0, Math.max(1, limit));
}

export function deleteResume(id: number) {
  const d = getDb();
  return d.delete(resumes).where(eq(resumes.id, id)).run();
}

/** Local alias for the shared tolerant parser — see src/lib/json.ts. */
const parseKeywordList = parseJsonStringArray;

/**
 * The arsenal as matching candidates.
 *
 * `excludeJobId` drops the resume already attached to the job being matched — recommending
 * "the one you just generated for this very posting" is never useful.
 */
export function getArsenalCandidates(excludeJobId?: number): ResumeCandidate[] {
  return listResumes()
    // A "reused" row is a COPY of another resume, attached to a job. Treating copies as
    // candidates let a copy of the master outrank a purpose-built resume for the same job
    // (it covers identical ground but, unlike the master, carried no master penalty). The
    // original is already in the pool, so copies are simply skipped.
    .filter((row) => row.type !== "reused")
    .filter((row) => !(excludeJobId != null && row.jobId === excludeJobId))
    .map((row) => {
      const full = getResumeById(row.id);
      if (!full) return null;
      return candidateFromResumeRow({
        id: full.id,
        type: full.type,
        label: full.label,
        roleTitle: full.roleTitle,
        keywords: full.keywords,
        content: full.content,
      });
    })
    .filter((c): c is ResumeCandidate => c !== null);
}

/**
 * Which resume you already have fits this job, and does it warrant a fresh tailoring.
 *
 * The job's own ATS keywords come from the `analyses` row when one exists; in practice that
 * table is usually empty, so the title and description carry the signal.
 */
export function recommendResumeForJob(jobId: number) {
  const job = getJobById(jobId);
  if (!job) return null;

  const analysis = getAnalysis(jobId);
  const keywords = parseKeywordList(analysis?.keywords);
  const profile = getTargetProfile();
  const hits = interestHits([job.role, job.description].filter(Boolean).join(" "), profile);
  const candidates = getArsenalCandidates(jobId);

  const recommendation = recommendResume(
    {
      role: job.role,
      company: job.company,
      keywords,
      interests: hits,
      description: job.description,
    },
    candidates
  );

  return { jobId, candidateCount: candidates.length, recommendation };
}

/**
 * Attach an existing resume to a job instead of tailoring a new one.
 *
 * Copies the content rather than pointing at it, because `getTailoredResume(jobId)` reads
 * the newest row for the job and the DOCX export renders from that row — so a copy keeps
 * both working with no changes, and records provenance via sourceResumeId.
 */
export function reuseResumeForJob(jobId: number, resumeId: number) {
  const d = getDb();
  const source = getResumeById(resumeId);
  if (!source) return null;

  const copy = saveTailoredResume(jobId, source.content, {
    type: "reused",
    label: source.label ?? source.roleTitle ?? `Resume #${source.id}`,
    roleTitle: source.roleTitle,
    keywords: parseKeywordList(source.keywords),
    sourceResumeId: source.id,
  });

  // Count reuses on the ORIGINAL, so the library can show which resumes earn their keep.
  d.update(resumes)
    .set({ reuseCount: (source.reuseCount ?? 0) + 1 })
    .where(eq(resumes.id, source.id))
    .run();

  return copy;
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

/**
 * Load the editable target profile from settings.
 *
 * A partial, missing or malformed profile never throws — it deep-merges onto
 * the defaults, so the ranker always has a complete profile to work from.
 */
export function getTargetProfile(): TargetProfile {
  return parseTargetProfile(getSetting(PROFILE_SETTING_KEY));
}

export function saveTargetProfile(profile: unknown): TargetProfile {
  const parsed = parseTargetProfile(profile);
  setSetting(PROFILE_SETTING_KEY, JSON.stringify(parsed));
  return parsed;
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
  config: {
    searches: { term: string; location: string }[];
    sites: string[];
    results: number;
    hours: number;
    distance?: number;
  },
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
      distance: config.distance ?? null,
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
        scoreInterest: a.scoreInterest ?? null,
        scoreEngagement: a.scoreEngagement ?? null,
        payInterval: a.payInterval ?? null,
        payLabel: a.payLabel ?? null,
        hoursVerdict: a.hoursVerdict ? JSON.stringify(a.hoursVerdict) : null,
        flags: a.flags ? JSON.stringify(a.flags) : null,
        penalties: a.penalties ? JSON.stringify(a.penalties) : null,
        schedule: JSON.stringify(a.schedule),
        benefits: JSON.stringify(a.benefits),
        notes: a.notes,
        details: JSON.stringify(a.requirements),
        estimatedSalaryMin: a.estimatedSalaryMin,
        estimatedSalaryMax: a.estimatedSalaryMax,
        salaryConfidence: a.salaryConfidence,
        socCode: a.socCode ?? null,
        adjustedSalaryMin: a.adjustedSalaryMin ?? null,
        adjustedSalaryMax: a.adjustedSalaryMax ?? null,
        colIndex: a.colIndex ?? null,
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
        scoreInterest: a.scoreInterest ?? null,
        scoreEngagement: a.scoreEngagement ?? null,
        payInterval: a.payInterval ?? null,
        payLabel: a.payLabel ?? null,
        hoursVerdict: a.hoursVerdict ? JSON.parse(a.hoursVerdict) : null,
        flags: a.flags ? JSON.parse(a.flags) : [],
        penalties: a.penalties ? JSON.parse(a.penalties) : [],
        schedule: a.schedule ? JSON.parse(a.schedule) : null,
        benefits: a.benefits ? JSON.parse(a.benefits) : [],
        notes: a.notes ?? "",
        requirements: a.details ? JSON.parse(a.details) : null,
        estimatedSalaryMin: a.estimatedSalaryMin ?? null,
        estimatedSalaryMax: a.estimatedSalaryMax ?? null,
        salaryConfidence: a.salaryConfidence ?? null,
        socCode: a.socCode ?? null,
        adjustedSalaryMin: a.adjustedSalaryMin ?? null,
        adjustedSalaryMax: a.adjustedSalaryMax ?? null,
        colIndex: a.colIndex ?? null,
        blsWage,
      },
    };
  });
}

// --- Bulk Runs (server-side all-states scan progress) ---

export interface BulkRunProgress {
  current?: string;
  errors: { state: string; error: string }[];
}

export function createBulkRun(id: string, total: number, config: unknown) {
  getDb()
    .insert(bulkRuns)
    .values({
      id,
      status: "running",
      total,
      done: 0,
      jobsTotal: 0,
      config: JSON.stringify(config),
      progress: JSON.stringify({ errors: [] } satisfies BulkRunProgress),
    })
    .run();
}

export function updateBulkRun(
  id: string,
  fields: { status?: string; done?: number; jobsTotal?: number; progress?: BulkRunProgress }
) {
  getDb()
    .update(bulkRuns)
    .set({
      updatedAt: sql`(datetime('now'))`,
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.done !== undefined ? { done: fields.done } : {}),
      ...(fields.jobsTotal !== undefined ? { jobsTotal: fields.jobsTotal } : {}),
      ...(fields.progress !== undefined ? { progress: JSON.stringify(fields.progress) } : {}),
    })
    .where(eq(bulkRuns.id, id))
    .run();
}

export function getBulkRun(id: string): BulkRunRow | null {
  return getDb().select().from(bulkRuns).where(eq(bulkRuns.id, id)).get() ?? null;
}

export function getActiveBulkRun(): BulkRunRow | null {
  return (
    getDb()
      .select()
      .from(bulkRuns)
      .where(eq(bulkRuns.status, "running"))
      .orderBy(desc(bulkRuns.startedAt))
      .get() ?? null
  );
}

// ── Analysis run tracking ────────────────────────────────────────────────────

export function createAnalysisRun(id: string, total: number): void {
  getDb().insert(analysisRuns).values({ id, total, analyzed: 0, errors: 0, status: "running" }).run();
}

export function updateAnalysisRun(
  id: string,
  fields: { status?: string; analyzed?: number; errors?: number }
) {
  getDb()
    .update(analysisRuns)
    .set({
      updatedAt: sql`(datetime('now'))`,
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.analyzed !== undefined ? { analyzed: fields.analyzed } : {}),
      ...(fields.errors !== undefined ? { errors: fields.errors } : {}),
    })
    .where(eq(analysisRuns.id, id))
    .run();
}

export function getAnalysisRun(id: string): AnalysisRunRow | null {
  return getDb().select().from(analysisRuns).where(eq(analysisRuns.id, id)).get() ?? null;
}

export function getActiveAnalysisRun(): AnalysisRunRow | null {
  return (
    getDb()
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.status, "running"))
      .orderBy(desc(analysisRuns.startedAt))
      .get() ?? null
  );
}

// ── Government job scrape runs ──────────────────────────────────────────────

export interface GovScrapeResultInput {
  title: string;
  company?: string;
  location: string | null;
  salary: string | null;
  datePosted: string | null;
  url: string | null;
  description: string | null;
}

export function saveGovScrapeRun(
  keyword: string,
  location: string,
  results: GovScrapeResultInput[]
) {
  const d = getDb();
  const run = d
    .insert(govScrapeRuns)
    .values({
      keyword,
      location,
      totalFound: results.length,
    })
    .returning()
    .get();

  if (results.length > 0) {
    d.insert(govScrapeResults)
      .values(
        results.map((r) => ({
          scrapeRunId: run.id,
          title: r.title,
          company: r.company ?? "State of Indiana",
          location: r.location,
          salary: r.salary,
          datePosted: r.datePosted,
          url: r.url,
          description: r.description,
        }))
      )
      .run();
  }

  return run;
}

export function getAllGovScrapeRuns() {
  const d = getDb();
  return d.select().from(govScrapeRuns).orderBy(desc(govScrapeRuns.createdAt)).all();
}

export function getGovScrapeRunById(id: number) {
  const d = getDb();
  return d.select().from(govScrapeRuns).where(eq(govScrapeRuns.id, id)).get() ?? null;
}

export function getGovScrapeResultsByRunId(runId: number): (GovScrapeResult & { company: string })[] {
  const d = getDb();
  return d
    .select()
    .from(govScrapeResults)
    .where(eq(govScrapeResults.scrapeRunId, runId))
    .all();
}

export function deleteGovScrapeRun(id: number) {
  const d = getDb();
  return d.delete(govScrapeRuns).where(eq(govScrapeRuns.id, id)).run();
}
