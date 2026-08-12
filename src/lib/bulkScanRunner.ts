import { runScrapeAndAnalyze } from "./scrapeRunner";
import type { SiteStatus } from "./scrapeRunner";
import { US_STATES } from "./usStates";
import { createBulkRun, updateBulkRun, type BulkRunProgress } from "./db/queries";

export interface BulkScanConfig {
  sites: string[];
  resultsBySite: Record<string, number>;
  hours: number;
  term: string;
  broadSearch: boolean;
  concurrency: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 5000;
const RETRY_JITTER_MS = 3000;
const PER_STATE_TIMEOUT_MS = 300_000;

// In-process registry of active runs (for cancellation). The progress itself
// lives in the DB so the UI can poll/reconnect after navigation or reload.
const registry = new Map<string, { cancelled: boolean }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarize(siteStatus?: SiteStatus[]): string {
  if (!siteStatus?.length) return "";
  return siteStatus
    .map((s) =>
      s.blocked ? `${s.site}: blocked` : s.failures > 0 ? `${s.site}: failed` : `${s.site}: ${s.results}`
    )
    .join(", ");
}

/** Run `worker` over `items` with at most `n` in flight at once. */
async function runPool<T>(
  items: T[],
  n: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let i = 0;
  const runNext = async (): Promise<void> => {
    const idx = i++;
    if (idx >= items.length) return;
    await worker(items[idx], idx);
    return runNext();
  };
  const lanes = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, () => runNext());
  await Promise.all(lanes);
}

/**
 * Kick off a server-side all-states scan. Returns a runId immediately; the work
 * continues in the background (fire-and-forget) on the long-lived node server.
 */
export function startBulkScan(config: BulkScanConfig): string {
  const runId = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  createBulkRun(runId, US_STATES.length, config);
  registry.set(runId, { cancelled: false });
  void runBulkScanServer(runId, config).catch((e) => {
    updateBulkRun(runId, {
      status: "error",
      progress: { errors: [{ state: "*", error: e instanceof Error ? e.message : String(e) }] },
    });
    registry.delete(runId);
  });
  return runId;
}

export function cancelBulkScan(id: string): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  entry.cancelled = true;
  return true;
}

async function runBulkScanServer(runId: string, config: BulkScanConfig): Promise<void> {
  const reg = registry.get(runId)!;
  const progress: BulkRunProgress = { errors: [] };
  let done = 0;
  let jobsTotal = 0;

  const resultsFallback = Math.max(50, ...Object.values(config.resultsBySite));

  await runPool(US_STATES, config.concurrency, async (state) => {
    if (reg.cancelled) return;

    const searches: { term: string; location: string }[] = [];
    if (config.term.trim()) searches.push({ term: config.term.trim(), location: state });
    if (config.broadSearch) searches.push({ term: "", location: state });
    if (searches.length === 0) searches.push({ term: "", location: state });

    let got = false;
    let lastReason = "no results returned";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !got && !reg.cancelled; attempt++) {
      try {
        const { count, siteStatus, error } = await runScrapeAndAnalyze(
          {
            searches,
            sites: config.sites,
            results: resultsFallback,
            hours: config.hours,
            resultsBySite: config.resultsBySite,
          },
          { timeoutMs: PER_STATE_TIMEOUT_MS, skipAnalysis: true, skipDedupe: true }
        );
        const summary = summarize(siteStatus);
        const anyBlocked = siteStatus?.some((s) => s.blocked);

        if (!error && count > 0) {
          jobsTotal += count;
          got = true;
          if (anyBlocked) progress.errors.push({ state, error: `${count} jobs, but ${summary}` });
        } else if (!error) {
          lastReason = summary ? `0 new — ${summary}` : "no results returned";
        } else {
          lastReason = summary ? `${error} — ${summary}` : error;
        }
      } catch (e) {
        lastReason = e instanceof Error ? e.message : String(e);
      }

      if (!got && attempt < MAX_ATTEMPTS && !reg.cancelled) {
        await sleep(RETRY_BASE_MS * Math.pow(3, attempt - 1) + Math.floor(Math.random() * RETRY_JITTER_MS));
      }
    }

    if (!got && !reg.cancelled) progress.errors.push({ state, error: lastReason });

    done++;
    progress.current = state;
    updateBulkRun(runId, { done, jobsTotal, progress });
  });

  updateBulkRun(runId, {
    status: reg.cancelled ? "cancelled" : "done",
    done,
    jobsTotal,
    progress,
  });
  registry.delete(runId);
}
