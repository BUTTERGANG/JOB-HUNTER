"use client";

import { useState, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { getJobIdentityKey } from "@/lib/jobIdentity";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchConfig {
  term: string;
  location: string;
}

interface JobSchedule {
  days: string[];
  hasOvertime: boolean;
  isRemote: boolean;
  hoursPerWeek: number | null;
  shiftType: string | null;
}

interface JobRequirements {
  degreeRequired: string | null;
  yearsExperience: number | null;
  certificationsRequired: string[];
  backgroundCheckRequired: boolean | null;
  locationArea: string;
}

interface BLSWageData {
  occTitle: string;
  aMedian: number | null;
  aPct25: number | null;
  aPct75: number | null;
  aMean: number | null;
  dataYear: number;
}

interface JobAnalysisData {
  rankScore: number;
  scorePay: number;
  scoreFlexibility: number;
  scoreLocation: number;
  scoreResponsibilities: number;
  scoreHours: number;
  scoreRequirements: number;
  schedule: JobSchedule | null;
  requirements: JobRequirements | null;
  benefits: string[];
  notes: string;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: "high" | "medium" | "low" | null;
  socCode: string | null;
  blsWage: BLSWageData | null;
}

interface ScrapedJob {
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
  analysis?: JobAnalysisData | null;
}

interface ScrapeMetrics {
  avgSalaryMin: number | null;
  avgSalaryMax: number | null;
  hasSalaryCount: number;
  remoteCount: number;
  sourceBreakdown: Record<string, number>;
  jobTypeBreakdown: Record<string, number>;
}

interface ScrapeRun {
  id: number;
  searches: string;
  sites: string;
  resultsPerSite: number | null;
  hours: number | null;
  totalFound: number;
  metrics: string | null;
  createdAt: string;
}

interface ScrapeRunDetail extends ScrapeRun {
  results: ScrapedJob[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SITES = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "indeed", label: "Indeed" },
  { id: "glassdoor", label: "Glassdoor" },
  { id: "zip_recruiter", label: "ZipRecruiter" },
  { id: "google", label: "Google" },
];

const HOURS_OPTIONS = [
  { value: 24, label: "Last 24 hours" },
  { value: 48, label: "Last 48 hours" },
  { value: 72, label: "Last 3 days" },
  { value: 168, label: "Last 7 days" },
  { value: 336, label: "Last 2 weeks" },
  { value: 720, label: "Last 30 days" },
];

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
  "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
  "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
  "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSalary(min: number | null, max: number | null) {
  if (!min && !max) return "—";
  const fmt = (n: number) => `$${(n / 1000).toFixed(0)}k`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  return min ? `${fmt(min)}+` : `≤${fmt(max!)}`;
}

function formatDate(iso: string) {
  return new Date(iso.replace(" ", "T")).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseSearches(raw: string): SearchConfig[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function parseMetrics(raw: string | null): ScrapeMetrics | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function searchesSummary(searches: SearchConfig[]): string {
  return searches.map((s) => `"${s.term}" @ ${s.location}`).join(", ");
}

function jobKey(job: ScrapedJob, fallback: number): string {
  return getJobIdentityKey(job) ?? `fallback:${fallback}:${job.company}:${job.role}`;
}

// ─── Score helpers ────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-green-200 dark:border-green-800";
  if (score >= 40) return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-200 dark:border-red-800";
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const color = value >= 7
    ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border-green-200 dark:border-green-800"
    : value >= 4
    ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800"
    : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${color}`}>
      {label} <span className="font-bold">{value}/10</span>
    </span>
  );
}

function SalaryCell({ job }: { job: ScrapedJob }) {
  const hasReal = job.salaryMin != null || job.salaryMax != null;
  if (hasReal) {
    return <span>{formatSalary(job.salaryMin, job.salaryMax)}</span>;
  }

  const bls = job.analysis?.blsWage;
  if (bls?.aMedian) {
    const range =
      bls.aPct25 && bls.aPct75
        ? formatSalary(bls.aPct25, bls.aPct75)
        : `$${(bls.aMedian / 1000).toFixed(0)}k`;
    return (
      <span
        className="text-blue-700 dark:text-blue-400 whitespace-nowrap"
        title={`BLS Indiana ${bls.dataYear} median $${(bls.aMedian / 1000).toFixed(0)}k · ${bls.occTitle}`}
      >
        ≈{range}
        <span className="text-xs opacity-60 ml-0.5">BLS</span>
      </span>
    );
  }

  const est = job.analysis;
  if (est?.estimatedSalaryMin != null || est?.estimatedSalaryMax != null) {
    const tip =
      est.salaryConfidence === "high"
        ? "Salary listed in posting"
        : est.salaryConfidence === "medium"
        ? "AI estimate — moderate confidence"
        : "AI estimate — low confidence";
    return (
      <span className="text-muted-foreground italic" title={tip}>
        ~{formatSalary(est.estimatedSalaryMin, est.estimatedSalaryMax)}
      </span>
    );
  }

  return <span>—</span>;
}

function HourlyCell({ job }: { job: ScrapedJob }) {
  const hr = (annual: number) => `$${Math.round(annual / 2080)}/hr`;

  if (job.salaryMin != null || job.salaryMax != null) {
    const annual =
      job.salaryMin != null && job.salaryMax != null
        ? (job.salaryMin + job.salaryMax) / 2
        : job.salaryMin ?? job.salaryMax!;
    return <span>{hr(annual)}</span>;
  }

  const bls = job.analysis?.blsWage;
  if (bls?.aMedian) {
    return (
      <span
        className="text-blue-700 dark:text-blue-400 whitespace-nowrap"
        title={`BLS Indiana ${bls.dataYear}`}
      >
        ≈{hr(bls.aMedian)}
        <span className="text-xs opacity-60 ml-0.5">BLS</span>
      </span>
    );
  }

  const est = job.analysis;
  if (est?.estimatedSalaryMin != null || est?.estimatedSalaryMax != null) {
    const mid =
      est.estimatedSalaryMin != null && est.estimatedSalaryMax != null
        ? (est.estimatedSalaryMin + est.estimatedSalaryMax) / 2
        : est.estimatedSalaryMin ?? est.estimatedSalaryMax!;
    return (
      <span className="text-muted-foreground italic" title="AI estimate">
        ~{hr(mid)}
      </span>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}

function DegreeTag({ degree }: { degree: string | null }) {
  if (!degree || degree === "none") {
    return <span className="text-green-700 dark:text-green-400 font-medium">Not required</span>;
  }
  const labels: Record<string, string> = {
    high_school: "High school",
    associate: "Associate's",
    bachelor: "Bachelor's",
    master: "Master's",
    phd: "PhD",
  };
  const label = labels[degree] ?? degree;
  const isHigh = degree === "bachelor" || degree === "master" || degree === "phd";
  return (
    <span className={isHigh ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-600 dark:text-amber-400"}>
      {label}
    </span>
  );
}

function formatSchedule(schedule: JobSchedule | null): string {
  if (!schedule) return "Schedule not specified";
  const parts: string[] = [];
  if (schedule.days.length > 0) parts.push(schedule.days.join(", "));
  if (schedule.hoursPerWeek) parts.push(`${schedule.hoursPerWeek}h/wk`);
  if (schedule.shiftType) parts.push(`${schedule.shiftType.charAt(0).toUpperCase() + schedule.shiftType.slice(1)} shift`);
  if (schedule.isRemote) parts.push("Remote available");
  if (schedule.hasOvertime) parts.push("Overtime expected");
  return parts.length > 0 ? parts.join(" · ") : "Schedule not specified";
}

// ─── Add button ──────────────────────────────────────────────────────────────

type AddState = "idle" | "adding" | "added" | "duplicate" | "error";

function AddButton({ state, onClick }: { state: AddState; onClick: (e: React.MouseEvent) => void }) {
  if (state === "added") {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-green-600 dark:text-green-400 font-bold text-sm"
        title="Added to tracking"
      >
        ✓
      </span>
    );
  }
  if (state === "duplicate") {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-amber-600 dark:text-amber-400 font-bold text-sm"
        title="Already in tracking"
      >
        ≈
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-red-500 font-bold text-sm"
        title="Failed to add"
      >
        ✗
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "adding"}
      className="inline-flex items-center justify-center w-6 h-6 rounded border border-transparent hover:border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 text-base leading-none"
      title="Add to job tracking"
    >
      {state === "adding" ? (
        <span className="text-xs">…</span>
      ) : (
        <span className="font-semibold">+</span>
      )}
    </button>
  );
}

// ─── Results Table (shared between New Scrape and Past Scrape detail) ────────

function ResultsTable({
  jobs,
  selected,
  onToggle,
  onToggleAll,
  showAnalysis,
}: {
  jobs: ScrapedJob[];
  selected?: Set<string>;
  onToggle?: (key: string) => void;
  onToggleAll?: () => void;
  showAnalysis?: boolean;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [addStates, setAddStates] = useState<Map<string, AddState>>(new Map());
  const selectable = !!selected;
  const visibleKeys = jobs.map((job, i) => jobKey(job, i));
  const allSelected = selectable && visibleKeys.length > 0 && visibleKeys.every((key) => selected!.has(key));
  const colCount = (selectable ? 1 : 0) + (showAnalysis ? 1 : 0) + 7 + 1;

  function toggleExpand(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedRow((prev) => (prev === key ? null : key));
  }

  async function addJob(i: number, e: React.MouseEvent) {
    e.stopPropagation();
    const key = jobKey(jobs[i], i);
    setAddStates((prev) => new Map(prev).set(key, "adding"));
    const job = jobs[i];
    try {
      const res = await fetch("/api/jobs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: [{
            company: job.company,
            role: job.role,
            location: job.location,
            url: job.url,
            source: job.source,
            description: job.description,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            status: "saved",
          }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      const nextState: AddState = res.ok
        ? data.skippedDuplicates > 0
          ? "duplicate"
          : "added"
        : "error";
      setAddStates((prev) => new Map(prev).set(key, nextState));
      if (!res.ok) {
        setTimeout(() => setAddStates((prev) => { const m = new Map(prev); m.delete(key); return m; }), 3000);
      }
    } catch {
      setAddStates((prev) => new Map(prev).set(key, "error"));
      setTimeout(() => setAddStates((prev) => { const m = new Map(prev); m.delete(key); return m; }), 3000);
    }
  }

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="rounded border-gray-300"
                />
              </TableHead>
            )}
            {showAnalysis && <TableHead className="w-[72px]">Score</TableHead>}
            <TableHead className="w-[200px]">Title</TableHead>
            <TableHead className="w-[150px]">Company</TableHead>
            <TableHead className="w-[130px]">Location</TableHead>
            <TableHead className="w-[110px] whitespace-nowrap">Salary</TableHead>
            <TableHead className="w-[80px] whitespace-nowrap">$/hr</TableHead>
            <TableHead className="w-[90px]">Source</TableHead>
            <TableHead className="w-[90px] whitespace-nowrap">Posted</TableHead>
            <TableHead className="w-14" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job, i) => {
            const key = visibleKeys[i];
            return (
            <Fragment key={key}>
              <TableRow
                className={`${selectable && !selected!.has(key) ? "opacity-40" : ""} ${showAnalysis ? "cursor-pointer" : ""}`}
                onClick={selectable ? () => onToggle!(key) : showAnalysis ? (e) => toggleExpand(key, e) : undefined}
              >
                {selectable && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected!.has(key)}
                      onChange={() => onToggle!(key)}
                      className="rounded border-gray-300"
                    />
                  </TableCell>
                )}
                {showAnalysis && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {job.analysis ? (
                      <span
                        className={`inline-flex items-center justify-center w-11 h-7 rounded border text-xs font-bold cursor-pointer ${scoreColor(job.analysis.rankScore)}`}
                        onClick={(e) => toggleExpand(key, e)}
                        title="Click to expand analysis"
                      >
                        {job.analysis.rankScore}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="font-medium max-w-[200px]">
                  <div className="truncate">
                    {job.url ? (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {job.role}
                      </a>
                    ) : (
                      job.role
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px]">
                  <div className="truncate">{job.company}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[130px]">
                  <div className="truncate">{job.location || "—"}</div>
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  <SalaryCell job={job} />
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  <HourlyCell job={job} />
                </TableCell>
                <TableCell>
                  {job.source ? (
                    <Badge variant="outline" className="text-xs capitalize whitespace-nowrap">
                      {job.source}
                    </Badge>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {job.datePosted || "—"}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <AddButton
                      state={addStates.get(key) ?? "idle"}
                      onClick={(e) => addJob(i, e)}
                    />
                    {showAnalysis && job.analysis && (
                      <span
                        className="text-muted-foreground text-xs select-none cursor-pointer"
                        onClick={(e) => toggleExpand(key, e)}
                      >
                        {expandedRow === key ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>

              {showAnalysis && expandedRow === key && job.analysis && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={colCount} className="py-3 px-4">
                    <div className="space-y-2.5">
                      {/* Score pills */}
                      <div className="flex flex-wrap gap-2">
                        <ScorePill label="Pay" value={job.analysis.scorePay} />
                        <ScorePill label="Flexibility" value={job.analysis.scoreFlexibility} />
                        <ScorePill label="Location" value={job.analysis.scoreLocation ?? 5} />
                        <ScorePill label="Requirements" value={job.analysis.scoreRequirements} />
                        <ScorePill label="Hours" value={job.analysis.scoreHours} />
                        <ScorePill label="Workload" value={job.analysis.scoreResponsibilities} />
                      </div>

                      {/* Requirements breakdown */}
                      {job.analysis.requirements && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span>
                            <span className="font-medium text-foreground">Degree: </span>
                            <DegreeTag degree={job.analysis.requirements.degreeRequired} />
                          </span>
                          {job.analysis.requirements.yearsExperience != null && (
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground">Exp: </span>
                              {job.analysis.requirements.yearsExperience === 0
                                ? "None required"
                                : `${job.analysis.requirements.yearsExperience}+ yrs`}
                            </span>
                          )}
                          {job.analysis.requirements.certificationsRequired.length > 0 && (
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground">Certs: </span>
                              {job.analysis.requirements.certificationsRequired.join(", ")}
                            </span>
                          )}
                          {job.analysis.requirements.backgroundCheckRequired != null && (
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground">BG Check: </span>
                              {job.analysis.requirements.backgroundCheckRequired ? "Required" : "Not mentioned"}
                            </span>
                          )}
                          {job.analysis.requirements.locationArea && job.analysis.requirements.locationArea !== "Unspecified" && (
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground">Area: </span>
                              {job.analysis.requirements.locationArea}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Schedule */}
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Schedule: </span>
                        {formatSchedule(job.analysis.schedule)}
                      </div>

                      {/* Benefits */}
                      {job.analysis.benefits.length > 0 && (
                        <div className="flex flex-wrap gap-1 items-center">
                          <span className="text-xs font-medium text-foreground mr-1">Benefits:</span>
                          {job.analysis.benefits.map((b) => (
                            <Badge key={b} variant="secondary" className="text-xs">
                              {b}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* BLS Indiana wage benchmark */}
                      {job.analysis.blsWage && (
                        <div className="text-xs">
                          <span className="font-medium text-foreground">
                            BLS Indiana ({job.analysis.blsWage.dataYear}):{" "}
                          </span>
                          <span className="text-blue-700 dark:text-blue-400 font-medium">
                            Median {job.analysis.blsWage.aMedian
                              ? `$${(job.analysis.blsWage.aMedian / 1000).toFixed(0)}k`
                              : "—"}
                          </span>
                          {job.analysis.blsWage.aPct25 && job.analysis.blsWage.aPct75 && (
                            <span className="text-muted-foreground">
                              {" "}· 25th ${(job.analysis.blsWage.aPct25 / 1000).toFixed(0)}k
                              {" "}· 75th ${(job.analysis.blsWage.aPct75 / 1000).toFixed(0)}k
                            </span>
                          )}
                          {job.analysis.socCode && (
                            <span className="text-muted-foreground/50 ml-1.5">
                              ({job.analysis.socCode} · {job.analysis.blsWage.occTitle})
                            </span>
                          )}
                        </div>
                      )}

                      {/* AI salary estimate (only show if listing had no salary) */}
                      {!job.salaryMin && !job.salaryMax &&
                        (job.analysis.estimatedSalaryMin != null || job.analysis.estimatedSalaryMax != null) && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">AI Salary Est.: </span>
                          <span className="italic">
                            {formatSalary(job.analysis.estimatedSalaryMin, job.analysis.estimatedSalaryMax)}
                          </span>
                          <span className="ml-1 text-muted-foreground/70">
                            ({job.analysis.salaryConfidence ?? "low"} confidence)
                          </span>
                        </div>
                      )}

                      {/* Notes */}
                      {job.analysis.notes && (
                        <p className="text-xs text-muted-foreground italic">{job.analysis.notes}</p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Metrics Summary Card ─────────────────────────────────────────────────────

function MetricsCard({ metrics, totalFound }: { metrics: ScrapeMetrics; totalFound: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
      <Card>
        <CardContent className="pt-4">
          <div className="text-2xl font-bold">{totalFound}</div>
          <div className="text-xs text-muted-foreground">Jobs Found</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-2xl font-bold">
            {metrics.hasSalaryCount > 0
              ? formatSalary(metrics.avgSalaryMin, metrics.avgSalaryMax)
              : "—"}
          </div>
          <div className="text-xs text-muted-foreground">
            Avg Salary ({metrics.hasSalaryCount} with data)
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-2xl font-bold">{metrics.remoteCount}</div>
          <div className="text-xs text-muted-foreground">Remote Listings</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-1">
            {Object.entries(metrics.sourceBreakdown).map(([src, n]) => (
              <Badge key={src} variant="secondary" className="text-xs capitalize">
                {src} ({n})
              </Badge>
            ))}
            {Object.keys(metrics.sourceBreakdown).length === 0 && (
              <span className="text-muted-foreground text-xs">—</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">By Source</div>
        </CardContent>
      </Card>
      {Object.keys(metrics.jobTypeBreakdown).length > 0 && (
        <Card className="col-span-2 sm:col-span-4">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(metrics.jobTypeBreakdown).map(([type, n]) => (
                <Badge key={type} variant="outline" className="text-xs">
                  {type} ({n})
                </Badge>
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Job Types</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Past Scrapes Tab ─────────────────────────────────────────────────────────

function PastScrapes() {
  const [runs, setRuns] = useState<ScrapeRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ScrapeRunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/scrapes")
      .then((r) => r.json())
      .then((data) => { setRuns(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function deleteRun(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("Delete this scrape run and all its results? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/scrapes/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRuns((prev) => prev.filter((r) => r.id !== id));
        if (expandedId === id) { setExpandedId(null); setDetail(null); }
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function loadDetail(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setLoadingDetail(true);
    const res = await fetch(`/api/scrapes/${id}`);
    const data = await res.json();
    setDetail(data);
    setLoadingDetail(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Spinner />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground text-sm">
          No scrapes recorded yet. Run a scrape first and it will appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const searches = parseSearches(run.searches);
        const metrics = parseMetrics(run.metrics);
        const isExpanded = expandedId === run.id;

        return (
          <Card key={run.id} className="overflow-hidden">
            <CardHeader
              className="cursor-pointer select-none py-4"
              onClick={() => loadDetail(run.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {searchesSummary(searches)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(run.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-bold">{run.totalFound}</div>
                    <div className="text-xs text-muted-foreground">jobs</div>
                  </div>
                  {metrics && metrics.hasSalaryCount > 0 && (
                    <div className="text-right hidden sm:block">
                      <div className="text-sm font-mono">
                        {formatSalary(metrics.avgSalaryMin, metrics.avgSalaryMax)}
                      </div>
                      <div className="text-xs text-muted-foreground">avg salary</div>
                    </div>
                  )}
                  {metrics && (
                    <div className="hidden md:flex flex-wrap gap-1 max-w-[160px] justify-end">
                      {Object.entries(metrics.sourceBreakdown).map(([src, n]) => (
                        <Badge key={src} variant="secondary" className="text-xs capitalize">
                          {src} {n}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => deleteRun(run.id, e)}
                    disabled={deletingId === run.id}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    title="Delete scrape run"
                  >
                    {deletingId === run.id ? (
                      <span className="text-xs w-4 h-4 inline-flex items-center justify-center">…</span>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                      </svg>
                    )}
                  </button>
                  <span className="text-muted-foreground text-sm">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 border-t">
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner />
                  </div>
                ) : detail ? (
                  <>
                    {metrics && (
                      <div className="mt-4">
                        <MetricsCard metrics={metrics} totalFound={run.totalFound} />
                      </div>
                    )}
                    {detail.results.length > 0 ? (
                      <ResultsTable
                        jobs={[...detail.results].sort((a, b) => {
                          const ra = (a as ScrapedJob).analysis?.rankScore ?? -1;
                          const rb = (b as ScrapedJob).analysis?.rankScore ?? -1;
                          return rb - ra;
                        })}
                        showAnalysis={detail.results.some((r) => (r as ScrapedJob).analysis != null)}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No results stored for this run.
                      </p>
                    )}
                  </>
                ) : null}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Bulk Market Scan ─────────────────────────────────────────────────────────

function BulkMarketScan() {
  const [bulkSites, setBulkSites] = useState<string[]>(["linkedin", "indeed", "google"]);
  const [bulkResults, setBulkResults] = useState(100);
  const [bulkHours, setBulkHours] = useState(168);
  const [bulkTerm, setBulkTerm] = useState("");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [resultCount, setResultCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [batchErrors, setBatchErrors] = useState<{ state: string; error: string }[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  function toggleBulkSite(id: string) {
    setBulkSites((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function runBulkScan() {
    setPhase("running");
    setError(null);
    setResultCount(0);
    setProgress({ done: 0, total: US_STATES.length, current: US_STATES[0] });
    setBatchErrors([]);

    // Run state-by-state for clearer error reporting and better resilience
    let totalJobs = 0;
    const errors: { state: string; error: string }[] = [];

    for (let i = 0; i < US_STATES.length; i++) {
      const state = US_STATES[i];
      setProgress({
        done: i,
        total: US_STATES.length,
        current: state,
      });

      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            searches: [{ term: bulkTerm.trim(), location: state }],
            sites: bulkSites,
            results: bulkResults,
            hours: bulkHours,
            skipAnalysis: true,
            skipDedupe: true,
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const data = await res.json();
        if (res.ok) {
          const count = data.count ?? 0;
          totalJobs += count;
          setResultCount(totalJobs);
          // Report states that returned 0 jobs (with reason if available)
          if (count === 0) {
            const reason = data.dedupe
              ? `0 of ${data.dedupe.inputCount} jobs were new (rest deduped or blocked)`
              : "no results returned";
            errors.push({ state, error: reason });
            setBatchErrors([...errors]);
          }
        } else {
          errors.push({ state, error: data.error ?? `HTTP ${res.status}` });
          setBatchErrors([...errors]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ state, error: msg });
        setBatchErrors([...errors]);
      }
    }

    setProgress({ done: US_STATES.length, total: US_STATES.length, current: "Done" });
    setBatchErrors(errors);
    setPhase("done");
  }

  const canRun = phase !== "running" && bulkSites.length > 0;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Market Scan — All 50 States + DC</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Scrape jobs across all US states for market analytics. Skips AI analysis for speed.
          Uses location-only or keyword + location searches with high result counts. Takes ~15–30 minutes.
        </p>

        {/* Search term */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Search term (optional — blank = all jobs in each state)
          </label>
          <Input
            value={bulkTerm}
            onChange={(e) => setBulkTerm(e.target.value)}
            placeholder="e.g. software engineer (or leave blank for everything)"
          />
        </div>

        {/* Sites */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Job Boards</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {SITES.map((site) => (
              <label key={site.id} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bulkSites.includes(site.id)}
                  onChange={() => toggleBulkSite(site.id)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">{site.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Results per site per state</label>
            <Input
              type="number"
              min={10}
              max={200}
              value={bulkResults}
              onChange={(e) => setBulkResults(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Posted within</label>
            <Select value={String(bulkHours)} onValueChange={(v) => v && setBulkHours(Number(v))}>
              <SelectTrigger>
                <SelectValue>
                  {HOURS_OPTIONS.find((o) => o.value === bulkHours)?.label ?? "Last 7 days"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HOURS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Run button */}
        <div className="flex items-center gap-3">
          <Button onClick={runBulkScan} disabled={!canRun} size="lg">
            {phase === "running" ? "Scanning…" : "Run All States"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {US_STATES.length} states × {bulkSites.length} sites × {bulkResults} results = up to{" "}
            {US_STATES.length * bulkSites.length * bulkResults} listings
          </span>
        </div>

        {/* Progress */}
        {phase === "running" && (
          <div className="space-y-2">
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-primary h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>State {progress.done + 1} of {progress.total}: {progress.current}</span>
              <span>{pct}% · {resultCount} jobs saved so far</span>
            </div>
          </div>
        )}

        {/* Results */}
        {phase === "done" && (
          <div className="space-y-3">
            <div className={`p-3 rounded-md text-sm ${resultCount > 0 ? "bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-300" : "bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300"}`}>
              {resultCount > 0
                ? `Done! ${resultCount} jobs saved across ${US_STATES.length} states. AI analysis was skipped — navigate to Market Analysis to see the data.`
                : `Scan completed but no jobs were returned across ${US_STATES.length} states. See errors below for details.`}
            </div>

            {/* Per-state errors */}
            {batchErrors.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowErrors((v) => !v)}
                  className="w-full flex items-center justify-between p-3 text-sm bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-950 transition-colors"
                >
                  <span className="font-medium text-red-700 dark:text-red-300">
                    {batchErrors.length} state{batchErrors.length !== 1 ? "s" : ""} failed or returned no results
                  </span>
                  <span className="text-red-500 text-xs">{showErrors ? "Hide" : "Show"} details</span>
                </button>
                {showErrors && (
                  <div className="max-h-48 overflow-y-auto divide-y">
                    {batchErrors.map((e, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs flex justify-between gap-4 hover:bg-muted/30">
                        <span className="font-medium shrink-0">{e.state}</span>
                        <span className="text-red-600 dark:text-red-400 text-right truncate" title={e.error}>{e.error}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {phase === "error" && error && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── New Scrape Tab ───────────────────────────────────────────────────────────

function NewScrape() {
  const router = useRouter();

  const [searches, setSearches] = useState<SearchConfig[]>([
    { term: "software engineer", location: "Remote" },
  ]);
  const [sites, setSites] = useState<string[]>(["linkedin", "indeed"]);
  const [results, setResults] = useState(25);
  const [hours, setHours] = useState(168);

  const [phase, setPhase] = useState<"idle" | "scraping" | "done" | "error">("idle");
  const [jobs, setJobs] = useState<ScrapedJob[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skippedDuplicates?: number; errors: string[] } | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterScore, setFilterScore] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterRemoteOnly, setFilterRemoteOnly] = useState(false);
  const [filterSalaryOnly, setFilterSalaryOnly] = useState(false);

  function addSearch() {
    setSearches((prev) => [...prev, { term: "", location: "" }]);
  }

  function removeSearch(i: number) {
    setSearches((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateSearch(i: number, field: "term" | "location", value: string) {
    setSearches((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    );
  }

  function toggleSite(id: string) {
    setSites((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function runScrape() {
    setPhase("scraping");
    setError(null);
    setJobs([]);
    setSelected(new Set());
    setImportResult(null);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searches, sites, results, hours }),
        signal: AbortSignal.timeout(130_000),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Scrape failed");
        setPhase("error");
        return;
      }

      // Sort by rank score descending if analysis is present
      const sorted: ScrapedJob[] = [...data.jobs].sort((a, b) => {
        const ra = a.analysis?.rankScore ?? -1;
        const rb = b.analysis?.rankScore ?? -1;
        return rb - ra;
      });
      setJobs(sorted);
      setSelected(new Set(sorted.map((job: ScrapedJob, i: number) => jobKey(job, i))));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request timed out or failed");
      setPhase("error");
    }
  }

  async function importSelected() {
    setImporting(true);
    const toImport = jobs
      .filter((job, i) => selected.has(jobKey(job, i)))
      .map((j) => ({
        company: j.company,
        role: j.role,
        location: j.location,
        url: j.url,
        source: j.source,
        description: j.description,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        status: "saved",
      }));

    try {
      const res = await fetch("/api/jobs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: toImport }),
      });
      const data = await res.json();
      setImportResult(data);
    } catch {
      setImportResult({ created: 0, errors: ["Network error"] });
    }

    setImporting(false);
  }

  const sourceOptions = Array.from(new Set(jobs.map((job) => job.source).filter(Boolean) as string[])).sort();
  const minScore = filterScore === "all" ? null : Number(filterScore);
  const filteredJobs = jobs.filter((job) => {
    const haystack = [job.role, job.company, job.location, job.source].join(" ").toLowerCase();
    const matchesQuery = !filterQuery.trim() || haystack.includes(filterQuery.trim().toLowerCase());
    const matchesScore = minScore == null || (job.analysis?.rankScore ?? -1) >= minScore;
    const matchesSource = filterSource === "all" || job.source === filterSource;
    const matchesRemote = !filterRemoteOnly || job.location?.toLowerCase().includes("remote") || !!job.analysis?.schedule?.isRemote;
    const matchesSalary = !filterSalaryOnly || job.salaryMin != null || job.salaryMax != null || job.analysis?.estimatedSalaryMin != null || job.analysis?.estimatedSalaryMax != null || !!job.analysis?.blsWage?.aMedian;
    return matchesQuery && matchesScore && matchesSource && matchesRemote && matchesSalary;
  });
  const visibleKeys = filteredJobs.map((job, i) => jobKey(job, i));
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleKeys.forEach((key) => next.delete(key));
      else visibleKeys.forEach((key) => next.add(key));
      return next;
    });
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const canScrape =
    phase !== "scraping" &&
    sites.length > 0 &&
    searches.some((s) => s.term.trim() || s.location.trim());

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Searches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {searches.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="Search term (optional — leave blank for all jobs)"
                value={s.term}
                onChange={(e) => updateSearch(i, "term", e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Location (e.g. Remote, San Francisco CA)"
                value={s.location}
                onChange={(e) => updateSearch(i, "location", e.target.value)}
                className="flex-1"
              />
              {searches.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSearch(i)}
                  className="shrink-0 px-2"
                  aria-label="Remove search"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addSearch}>
            + Add Search
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Job Boards</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {SITES.map((site) => (
                <label key={site.id} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sites.includes(site.id)}
                    onChange={() => toggleSite(site.id)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">{site.label}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Options</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Results per site</label>
              <Input
                type="number"
                min={5}
                max={100}
                value={results}
                onChange={(e) => setResults(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Posted within</label>
              <Select value={String(hours)} onValueChange={(v) => v && setHours(Number(v))}>
                <SelectTrigger>
                  <SelectValue>
                    {HOURS_OPTIONS.find((o) => o.value === hours)?.label ?? "Last 7 days"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOURS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button onClick={runScrape} disabled={!canScrape} size="lg">
        {phase === "scraping" ? "Scraping + analyzing… (45–90s)" : "Run Scrape"}
      </Button>

      {phase === "error" && error && (
        <div className="p-4 rounded-md bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">Scrape failed</p>
          <p className="text-xs text-red-500 mt-1">{error}</p>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <Input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Search title, company, location…"
                className="md:col-span-2"
              />
              <Select value={filterScore} onValueChange={(v) => v && setFilterScore(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any score</SelectItem>
                  <SelectItem value="70">70+</SelectItem>
                  <SelectItem value="80">80+</SelectItem>
                  <SelectItem value="90">90+</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterSource} onValueChange={(v) => v && setFilterSource(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any source</SelectItem>
                  {sourceOptions.map((source) => (
                    <SelectItem key={source} value={source}>{source}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={filterRemoteOnly} onChange={(e) => setFilterRemoteOnly(e.target.checked)} />
                  Remote
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={filterSalaryOnly} onChange={(e) => setFilterSalaryOnly(e.target.checked)} />
                  Salary
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold">{filteredJobs.length} of {jobs.length} jobs shown</h2>
              <p className="text-sm text-muted-foreground">{selected.size} selected for import</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
              <Button
                onClick={importSelected}
                disabled={selected.size === 0 || importing || !!importResult}
              >
                {importing ? "Importing…" : `Import ${selected.size}`}
              </Button>
            </div>
          </div>

          {importResult && (
            <div
              className={`p-3 rounded-md text-sm flex items-center justify-between ${
                importResult.errors.length > 0
                  ? "bg-yellow-50 border border-yellow-200 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-300"
                  : "bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-300"
              }`}
            >
              <span>
                {importResult.created} jobs imported.
                {!!importResult.skippedDuplicates && ` ${importResult.skippedDuplicates} already tracked.`}
                {importResult.errors.length > 0 && ` ${importResult.errors.length} errors.`}
              </span>
              <Button variant="outline" size="sm" onClick={() => router.push("/jobs")}>
                View Jobs
              </Button>
            </div>
          )}

          <ResultsTable
            jobs={filteredJobs}
            selected={selected}
            onToggle={toggleRow}
            onToggleAll={toggleAll}
            showAnalysis={filteredJobs.some((j) => j.analysis != null)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScrapePage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Scrape Jobs</h1>

      {/* Bulk Market Scan — always visible at top */}
      <div className="mb-6">
        <BulkMarketScan />
      </div>

      <Tabs defaultValue="new">
        <TabsList className="mb-6">
          <TabsTrigger value="new">New Scrape</TabsTrigger>
          <TabsTrigger value="history">Past Scrapes</TabsTrigger>
        </TabsList>
        <TabsContent value="new">
          <NewScrape />
        </TabsContent>
        <TabsContent value="history">
          <PastScrapes />
        </TabsContent>
      </Tabs>
    </div>
  );
}
