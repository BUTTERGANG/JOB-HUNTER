import { db } from "@/lib/db/index";
import { scrapeResults } from "@/lib/db/schema";
import { sql, notInArray } from "drizzle-orm";
import { getSetting, saveJobAnalyses, createAnalysisRun, updateAnalysisRun } from "@/lib/db/queries";
import { analyzeJobsBatch } from "@/lib/ai/analyzeJobs";

const BATCH_SIZE = 40;
const BETWEEN_BATCH_MS = 500;

const registry = new Map<string, { cancelled: boolean }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startAnalysisRun(): { runId: string; total: number } | { error: string } {
  if (registry.size > 0) {
    const existing = [...registry.keys()][0];
    return { error: `Analysis run already in progress: ${existing}` };
  }

  const apiKey = getSetting("anthropic_api_key");
  if (!apiKey) return { error: "Anthropic API key not configured in Settings." };

  const d = db();
  const [{ unanalyzed }] = d
    .select({ unanalyzed: sql<number>`count(*)` })
    .from(scrapeResults)
    .where(sql`${scrapeResults.id} NOT IN (SELECT scrape_result_id FROM job_analysis)`)
    .all() as [{ unanalyzed: number }];

  const total = Number(unanalyzed);
  if (total === 0) return { error: "All jobs are already analyzed." };

  const runId = `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  createAnalysisRun(runId, total);
  registry.set(runId, { cancelled: false });

  void runAnalysis(runId, apiKey, total).catch((e) => {
    updateAnalysisRun(runId, { status: "error" });
    registry.delete(runId);
    console.error("analysisRunner error:", e);
  });

  return { runId, total };
}

export function cancelAnalysisRun(id: string): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.cancelled = true;
  return true;
}

export function getActiveAnalysisRunId(): string | null {
  const ids = [...registry.keys()];
  return ids.length > 0 ? ids[0] : null;
}

async function runAnalysis(runId: string, apiKey: string, total: number): Promise<void> {
  const reg = registry.get(runId)!;
  const d = db();
  let analyzed = 0;
  let errors = 0;
  // IDs whose batch threw this run. We skip them for the rest of this run so
  // the while loop can't spin forever on the same bad rows, but we deliberately
  // do NOT persist anything for them — a transient API failure should leave the
  // rows genuinely unanalyzed so the next run retries them, rather than stamping
  // fake rankScore:0 rows that masquerade as real low-ranked jobs.
  const failedIds = new Set<number>();

  while (!reg.cancelled) {
    const notAnalyzed = sql`${scrapeResults.id} NOT IN (SELECT scrape_result_id FROM job_analysis)`;
    const whereClause =
      failedIds.size > 0
        ? sql`${notAnalyzed} AND ${notInArray(scrapeResults.id, [...failedIds])}`
        : notAnalyzed;

    const rows = d
      .select({
        id: scrapeResults.id,
        role: scrapeResults.role,
        company: scrapeResults.company,
        location: scrapeResults.location,
        salaryMin: scrapeResults.salaryMin,
        salaryMax: scrapeResults.salaryMax,
        jobType: scrapeResults.jobType,
      })
      .from(scrapeResults)
      .where(whereClause)
      .limit(BATCH_SIZE)
      .all();

    if (rows.length === 0) break;

    try {
      // scrape_results has no description column — bulk runs skip description fetching.
      // Analysis is based on title, company, location, salary, and job type only.
      const jobs = rows.map((r) => ({
        role: r.role,
        company: r.company,
        location: r.location ?? null,
        salaryMin: r.salaryMin ?? null,
        salaryMax: r.salaryMax ?? null,
        jobType: r.jobType ?? null,
        description: null,
      }));

      const analyses = await analyzeJobsBatch(jobs, apiKey);
      const ids = rows.map((r) => r.id);
      saveJobAnalyses(ids, analyses);
      analyzed += analyses.length;
    } catch (e) {
      errors++;
      // Skip these rows for the rest of this run so we don't re-fetch and
      // re-fail them on the next loop iteration. We intentionally persist
      // nothing: the rows stay unanalyzed and a later run will retry them,
      // instead of being permanently excluded by fake zero-score rows.
      console.error("analyzeJobsBatch failed for batch:", e);
      for (const r of rows) failedIds.add(r.id);
    }

    updateAnalysisRun(runId, { analyzed, errors });

    if (!reg.cancelled) await sleep(BETWEEN_BATCH_MS);
  }

  updateAnalysisRun(runId, {
    status: reg.cancelled ? "cancelled" : "done",
    analyzed,
    errors,
  });
  registry.delete(runId);
}
