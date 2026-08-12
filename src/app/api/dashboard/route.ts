import { db } from "@/lib/db/index";
import { scrapeResults, jobAnalysis, scrapeRuns, jobs } from "@/lib/db/schema";
import { sql, desc, eq } from "drizzle-orm";
import { normalizeJobUrl } from "@/lib/jobIdentity";
import { FOLLOW_UP_DAYS, TERMINAL_STATUSES } from "@/lib/constants";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";
import { NextRequest, NextResponse } from "next/server";

interface RawRow {
  id: number;
  scrapeRunId: number;
  role: string;
  company: string;
  location: string | null;
  url: string | null;
  source: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  datePosted: string | null;
  rankScore: number | null;
  scorePay: number | null;
  scoreFlexibility: number | null;
  scoreLocation: number | null;
  scoreRequirements: number | null;
  scoreHours: number | null;
  notes: string | null;
  details: string | null;
  schedule: string | null;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: string | null;
  adjustedSalaryMin: number | null;
  adjustedSalaryMax: number | null;
  colIndex: number | null;
}

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function bucketScore(n: number): string {
  if (n <= 20) return "0–20";
  if (n <= 40) return "21–40";
  if (n <= 60) return "41–60";
  if (n <= 80) return "61–80";
  return "81–100";
}

async function GET_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const d = db();

  // ── Scrape results joined with analysis ──────────────────────────────────
  const rows: RawRow[] = d
    .select({
      id: scrapeResults.id,
      scrapeRunId: scrapeResults.scrapeRunId,
      role: scrapeResults.role,
      company: scrapeResults.company,
      location: scrapeResults.location,
      url: scrapeResults.url,
      source: scrapeResults.source,
      salaryMin: scrapeResults.salaryMin,
      salaryMax: scrapeResults.salaryMax,
      datePosted: scrapeResults.datePosted,
      rankScore: jobAnalysis.rankScore,
      scorePay: jobAnalysis.scorePay,
      scoreFlexibility: jobAnalysis.scoreFlexibility,
      scoreLocation: jobAnalysis.scoreLocation,
      scoreRequirements: jobAnalysis.scoreRequirements,
      scoreHours: jobAnalysis.scoreHours,
      notes: jobAnalysis.notes,
      details: jobAnalysis.details,
      schedule: jobAnalysis.schedule,
      estimatedSalaryMin: jobAnalysis.estimatedSalaryMin,
      estimatedSalaryMax: jobAnalysis.estimatedSalaryMax,
      salaryConfidence: jobAnalysis.salaryConfidence,
      adjustedSalaryMin: jobAnalysis.adjustedSalaryMin,
      adjustedSalaryMax: jobAnalysis.adjustedSalaryMax,
      colIndex: jobAnalysis.colIndex,
    })
    .from(scrapeResults)
    .leftJoin(jobAnalysis, sql`${scrapeResults.id} = ${jobAnalysis.scrapeResultId}`)
    .all();

  // Deduplicate by normalized URL, keeping highest rankScore
  const deduped = new Map<string, RawRow>();
  for (const row of rows) {
    const key = normalizeJobUrl(row.url) ?? `text:${row.company}|${row.role}|${row.location ?? ""}`;
    const existing = deduped.get(key);
    if (!existing || (row.rankScore ?? -1) > (existing.rankScore ?? -1)) {
      deduped.set(key, row);
    }
  }
  const unique = Array.from(deduped.values());

  // ── Aggregate stats ──────────────────────────────────────────────────────
  const analyzed = unique.filter((r) => r.rankScore != null);
  let scoreSum = 0;
  let highScoreCount = 0;
  // remote/degree computed only from analyzed rows (others have no schedule/details JSON)
  let remoteCount = 0;
  let noDegreeCount = 0;
  let salaryCount = 0;
  let salarySum = 0;
  const scoreBuckets: Record<string, number> = {};
  const sourceBreakdown: Record<string, number> = {};

  for (const r of unique) {
    // Use COL-adjusted salary when available for fair cross-state comparison
    const salMin = r.adjustedSalaryMin ?? r.salaryMin ?? r.estimatedSalaryMin;
    if (salMin != null) {
      salarySum += salMin;
      salaryCount++;
    }
    const src = r.source ?? "Unknown";
    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
  }

  for (const r of analyzed) {
    const s = r.rankScore!;
    scoreSum += s;
    if (s >= 70) highScoreCount++;
    const bucket = bucketScore(s);
    scoreBuckets[bucket] = (scoreBuckets[bucket] || 0) + 1;

    const sched = parseJSON<{ isRemote?: boolean }>(r.schedule, {});
    if (sched.isRemote) remoteCount++;

    const det = parseJSON<{ degreeRequired?: string | null }>(r.details, {});
    const deg = det.degreeRequired ?? null;
    if (!deg || deg === "none") noDegreeCount++;
  }

  const avgScore = analyzed.length > 0 ? Math.round(scoreSum / analyzed.length) : null;
  const avgSalary = salaryCount > 0 ? Math.round(salarySum / salaryCount) : null;

  const scoreDistribution = ["0–20", "21–40", "41–60", "61–80", "81–100"].map((range) => ({
    range,
    count: scoreBuckets[range] ?? 0,
  }));

  const sourceList = Object.entries(sourceBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // ── Top jobs by rankScore ────────────────────────────────────────────────
  const topJobs = analyzed
    .sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0))
    .slice(0, 20)
    .map((r) => {
      const det = parseJSON<{ degreeRequired?: string | null; yearsExperience?: number | null; locationArea?: string | null }>(r.details, {});
      return {
        id: r.id,
        scrapeRunId: r.scrapeRunId,
        role: r.role,
        company: r.company,
        location: r.location,
        url: r.url,
        source: r.source,
        salaryMin: r.salaryMin,
        salaryMax: r.salaryMax,
        estimatedSalaryMin: r.estimatedSalaryMin,
        estimatedSalaryMax: r.estimatedSalaryMax,
        adjustedSalaryMin: r.adjustedSalaryMin,
        adjustedSalaryMax: r.adjustedSalaryMax,
        colIndex: r.colIndex,
        salaryConfidence: r.salaryConfidence,
        rankScore: r.rankScore!,
        scorePay: r.scorePay,
        scoreFlexibility: r.scoreFlexibility,
        scoreLocation: r.scoreLocation,
        scoreRequirements: r.scoreRequirements,
        scoreHours: r.scoreHours,
        notes: r.notes,
        degreeRequired: det.degreeRequired ?? null,
        yearsExperience: det.yearsExperience ?? null,
      };
    });

  // ── Recent scrape runs ───────────────────────────────────────────────────
  const recentRuns = d
    .select({
      id: scrapeRuns.id,
      createdAt: scrapeRuns.createdAt,
      totalFound: scrapeRuns.totalFound,
      searches: scrapeRuns.searches,
    })
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.createdAt))
    .limit(5)
    .all()
    .map((run) => {
      const searches = parseJSON<{ term: string; location: string }[]>(run.searches, []);
      const label = searches.map((s) => s.term).join(", ") || "Scrape";
      return { id: run.id, createdAt: run.createdAt, totalFound: run.totalFound, label };
    });

  // ── Application pipeline (from jobs table) ───────────────────────────────
  const allJobs = d.select().from(jobs).orderBy(desc(jobs.createdAt)).all();
  const statusCounts: Record<string, number> = {};
  let totalApplied = 0;
  let activeInterviews = 0;
  let offers = 0;
  const needFollowUp: { id: number; company: string; role: string; dateApplied: string; daysSince: number }[] = [];
  const now = Date.now();

  for (const job of allJobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    if (job.status !== "saved") totalApplied++;
    if (["phone_screen", "technical", "onsite"].includes(job.status)) activeInterviews++;
    if (job.status === "offer") offers++;
    if (job.status === "applied" && job.dateApplied) {
      const daysSince = Math.floor((now - new Date(job.dateApplied).getTime()) / 86400000);
      if (daysSince >= FOLLOW_UP_DAYS) {
        needFollowUp.push({ id: job.id, company: job.company, role: job.role, dateApplied: job.dateApplied, daysSince });
      }
    }
  }

  return Response.json({
    scrape: {
      total: unique.length,
      analyzed: analyzed.length,
      avgScore,
      highScoreCount,
      // these three are scoped to analyzed rows only (unanalyzed rows have no schedule/details)
      remotePct: analyzed.length > 0 ? Math.round((remoteCount / analyzed.length) * 100) : 0,
      noDegreePct: analyzed.length > 0 ? Math.round((noDegreeCount / analyzed.length) * 100) : 0,
      salaryPct: unique.length > 0 ? Math.round((salaryCount / unique.length) * 100) : 0,
      avgSalary,
      sourceBreakdown: sourceList,
    },
    topJobs,
    scoreDistribution,
    recentRuns,
    pipeline: {
      statusCounts,
      totalApplied,
      activeInterviews,
      offers,
      needFollowUp,
      total: allJobs.length,
    },
  }, { headers: rateLimit.headers });
}

export const GET = GET_handler;
