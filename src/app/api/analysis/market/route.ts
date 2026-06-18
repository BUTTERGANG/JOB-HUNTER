import { NextRequest } from "next/server";
import { db } from "@/lib/db/index";
import { scrapeResults, jobAnalysis } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { normalizeJobUrl } from "@/lib/jobIdentity";
import { getSocSectorName } from "@/lib/socSectors";

interface ScrapedRow {
  id: number;
  role: string;
  company: string;
  location: string | null;
  url: string | null;
  source: string | null;
  jobType: string | null;
  datePosted: string | null;
  createdAt: string;
  rankScore: number | null;
  scorePay: number | null;
  scoreFlexibility: number | null;
  scoreLocation: number | null;
  scheduleStr: string | null;
  benefitsStr: string | null;
  detailsStr: string | null;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: string | null;
  socCode: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function bucketSalary(n: number): string {
  if (n < 30000) return "<$30k";
  if (n < 40000) return "$30–40k";
  if (n < 50000) return "$40–50k";
  if (n < 60000) return "$50–60k";
  if (n < 75000) return "$60–75k";
  if (n < 90000) return "$75–90k";
  if (n < 110000) return "$90–110k";
  if (n < 130000) return "$110–130k";
  if (n < 160000) return "$130–160k";
  return "$160k+";
}

function bucketScore(n: number): string {
  if (n <= 20) return "0–20";
  if (n <= 40) return "21–40";
  if (n <= 60) return "41–60";
  if (n <= 80) return "61–80";
  return "81–100";
}

function bucketExperience(years: number | null): string {
  if (years == null) return "Not specified";
  if (years === 0) return "Entry level (0)";
  if (years <= 2) return "1–2 years";
  if (years <= 5) return "3–5 years";
  if (years <= 10) return "6–10 years";
  return "10+ years";
}

function getWeekKey(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    // Get the Monday of the week
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setUTCDate(diff);
    return monday.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregate(raw: ScrapedRow[], sourceFilter: string | null) {
  // Optional source filter
  const rows = sourceFilter && sourceFilter !== "all"
    ? raw.filter((r) => r.source === sourceFilter)
    : raw;

  // Deduplicate by normalized URL — keep most recent
  const deduped = new Map<string, ScrapedRow>();
  let dupCount = 0;
  for (const row of rows) {
    const url = normalizeJobUrl(row.url);
    const key = url ?? `text:${row.company}|${row.role}|${row.location ?? ""}`;
    const existing = deduped.get(key);
    if (!existing || row.createdAt > existing.createdAt) {
      if (existing) dupCount++;
      deduped.set(key, row);
    }
  }
  const unique = Array.from(deduped.values());

  // Counts
  const totalRaw = rows.length;
  const totalUnique = unique.length;

  // Sector breakdown (SOC)
  const sectorCounts: Record<string, number> = {};
  for (const r of unique) {
    const sector = getSocSectorName(r.socCode);
    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
  }
  const sectorBreakdown = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Job type
  const typeCounts: Record<string, number> = {};
  for (const r of unique) {
    const t = r.jobType ? r.jobType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unspecified";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const jobTypeBreakdown = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Degree requirements
  const degreeCounts: Record<string, number> = {};
  for (const r of unique) {
    const reqs = parseJSON<{ degreeRequired: string | null }>(r.detailsStr, { degreeRequired: null });
    const label = reqs.degreeRequired ?? "Not mentioned";
    const pretty: Record<string, string> = {
      "none": "Not required",
      "high_school": "High school",
      "associate": "Associate's",
      "bachelor": "Bachelor's",
      "master": "Master's",
      "phd": "PhD",
    };
    const key = pretty[label] ?? label;
    degreeCounts[key] = (degreeCounts[key] || 0) + 1;
  }
  const degreeBreakdown = Object.entries(degreeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Location area
  const locationCounts: Record<string, number> = {};
  for (const r of unique) {
    const reqs = parseJSON<{ locationArea: string }>(r.detailsStr, { locationArea: "Unspecified" });
    const key = reqs.locationArea ?? "Unspecified";
    locationCounts[key] = (locationCounts[key] || 0) + 1;
  }
  const locationBreakdown = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Remote vs onsite
  let remoteCount = 0;
  let onsiteCount = 0;
  for (const r of unique) {
    const sched = parseJSON<{ isRemote: boolean }>(r.scheduleStr, { isRemote: false });
    if (sched.isRemote) remoteCount++;
    else onsiteCount++;
  }

  // Salary distribution (use actual min if available, otherwise estimated)
  const salaryBuckets: Record<string, number> = {};
  let salarySum = 0, salaryCount = 0;
  for (const r of unique) {
    const sal = r.estimatedSalaryMin ?? r.scorePay != null ? null : null; // prefer estimated
    // We only have estimatedSalaryMin from analysis, not scraped salaryMin in this query
    // Fall back to estimatedSalaryMin
    const min = r.estimatedSalaryMin;
    if (min != null) {
      const bucket = bucketSalary(min);
      salaryBuckets[bucket] = (salaryBuckets[bucket] || 0) + 1;
      salarySum += min;
      salaryCount++;
    }
  }
  const salaryDistribution = Object.entries(salaryBuckets)
    .sort((a, b) => {
      const order = ["<$30k", "$30–40k", "$40–50k", "$50–60k", "$60–75k", "$75–90k", "$90–110k", "$110–130k", "$130–160k", "$160k+"];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    })
    .map(([range, count]) => ({ range, count }));

  // Score distribution
  const scoreBuckets: Record<string, number> = {};
  let scoreSum = 0, scoreCount = 0;
  for (const r of unique) {
    if (r.rankScore == null) continue;
    const bucket = bucketScore(r.rankScore);
    scoreBuckets[bucket] = (scoreBuckets[bucket] || 0) + 1;
    scoreSum += r.rankScore;
    scoreCount++;
  }
  const scoreDistribution = Object.entries(scoreBuckets)
    .sort((a, b) => {
      const order = ["0–20", "21–40", "41–60", "61–80", "81–100"];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    })
    .map(([range, count]) => ({ range, count }));

  // Top companies
  const companyCounts: Record<string, number> = {};
  for (const r of unique) {
    if (!r.company) continue;
    companyCounts[r.company] = (companyCounts[r.company] || 0) + 1;
  }
  const topCompanies = Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  // Experience breakdown
  const expCounts: Record<string, number> = {};
  for (const r of unique) {
    const reqs = parseJSON<{ yearsExperience: number | null }>(r.detailsStr, { yearsExperience: null });
    const key = bucketExperience(reqs.yearsExperience ?? null);
    expCounts[key] = (expCounts[key] || 0) + 1;
  }
  const experienceBreakdown = Object.entries(expCounts)
    .sort((a, b) => {
      const order = ["Entry level (0)", "1–2 years", "3–5 years", "6–10 years", "10+ years", "Not specified"];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    })
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Source breakdown
  const sourceCounts: Record<string, number> = {};
  for (const r of unique) {
    const s = r.source ?? "Unknown";
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  }
  const sourceBreakdown = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Timeline (weekly buckets, sorted chronologically)
  const timelineCounts: Record<string, number> = {};
  for (const r of unique) {
    const week = getWeekKey(r.datePosted) ?? getWeekKey(r.createdAt);
    if (week) timelineCounts[week] = (timelineCounts[week] || 0) + 1;
  }
  const postingsTimeline = Object.entries(timelineCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, count]) => ({ week, count }));

  // Benefits frequency
  const benefitCounts: Record<string, number> = {};
  for (const r of unique) {
    const benefits = parseJSON<string[]>(r.benefitsStr, []);
    for (const b of benefits) {
      benefitCounts[b] = (benefitCounts[b] || 0) + 1;
    }
  }
  const topBenefits = Object.entries(benefitCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / totalUnique) * 100) }));

  // Average score
  const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null;
  const avgSalary = salaryCount > 0 ? Math.round(salarySum / salaryCount) : null;

  return {
    totalRaw,
    totalUnique,
    duplicatesRemoved: totalRaw - totalUnique,
    avgScore,
    avgSalary,
    remotePct: totalUnique > 0 ? Math.round((remoteCount / totalUnique) * 100) : 0,
    sectorBreakdown,
    jobTypeBreakdown,
    degreeBreakdown,
    locationBreakdown,
    remoteVsOnsite: { remote: remoteCount, onsite: onsiteCount },
    salaryDistribution,
    scoreDistribution,
    topCompanies,
    experienceBreakdown,
    sourceBreakdown,
    postingsTimeline,
    topBenefits,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sourceFilter = searchParams.get("source");
  const minScoreParam = searchParams.get("minScore");

  const d = db();

  // Join scrape_results with job_analysis
  const rows: ScrapedRow[] = d
    .select({
      id: scrapeResults.id,
      role: scrapeResults.role,
      company: scrapeResults.company,
      location: scrapeResults.location,
      url: scrapeResults.url,
      source: scrapeResults.source,
      jobType: scrapeResults.jobType,
      datePosted: scrapeResults.datePosted,
      createdAt: scrapeResults.createdAt,
      rankScore: jobAnalysis.rankScore,
      scorePay: jobAnalysis.scorePay,
      scoreFlexibility: jobAnalysis.scoreFlexibility,
      scoreLocation: jobAnalysis.scoreLocation,
      scheduleStr: jobAnalysis.schedule,
      benefitsStr: jobAnalysis.benefits,
      detailsStr: jobAnalysis.details,
      estimatedSalaryMin: jobAnalysis.estimatedSalaryMin,
      estimatedSalaryMax: jobAnalysis.estimatedSalaryMax,
      salaryConfidence: jobAnalysis.salaryConfidence,
      socCode: jobAnalysis.socCode,
    })
    .from(scrapeResults)
    .leftJoin(jobAnalysis, sql`${scrapeResults.id} = ${jobAnalysis.scrapeResultId}`)
    .all();

  // Apply minScore filter at API level
  let filtered = rows;
  const minScore = minScoreParam ? Number(minScoreParam) : 0;
  if (minScore > 0) {
    filtered = rows.filter((r) => (r.rankScore ?? 0) >= minScore);
  }

  const result = aggregate(filtered, sourceFilter);

  return Response.json(result);
}
