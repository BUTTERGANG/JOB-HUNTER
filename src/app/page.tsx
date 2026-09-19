"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { JOB_STATUSES, TERMINAL_STATUSES } from "@/lib/constants";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopJob {
  id: number;
  scrapeRunId: number;
  role: string;
  company: string;
  location: string | null;
  url: string | null;
  source: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: string | null;
  rankScore: number;
  scorePay: number | null;
  scoreFlexibility: number | null;
  scoreLocation: number | null;
  scoreRequirements: number | null;
  scoreHours: number | null;
  notes: string | null;
  degreeRequired: string | null;
  yearsExperience: number | null;
}

interface DashboardData {
  scrape: {
    total: number;
    analyzed: number;
    avgScore: number | null;
    highScoreCount: number;
    remotePct: number;
    noDegreePct: number;
    salaryPct: number;
    avgSalary: number | null;
    sourceBreakdown: { name: string; count: number }[];
  };
  topJobs: TopJob[];
  scoreDistribution: { range: string; count: number }[];
  recentRuns: { id: number; createdAt: string; totalFound: number; label: string }[];
  pipeline: {
    statusCounts: Record<string, number>;
    totalApplied: number;
    activeInterviews: number;
    offers: number;
    needFollowUp: { id: number; company: string; role: string; dateApplied: string; daysSince: number }[];
    total: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 75) return "text-green-600";
  if (s >= 55) return "text-blue-600";
  if (s >= 35) return "text-yellow-600";
  return "text-muted-foreground";
}

function scoreBg(s: number) {
  if (s >= 75) return "bg-green-100 text-green-800";
  if (s >= 55) return "bg-blue-100 text-blue-800";
  if (s >= 35) return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}

function barColor(range: string) {
  if (range === "81–100") return "#16a34a";
  if (range === "61–80") return "#2563eb";
  if (range === "41–60") return "#ca8a04";
  if (range === "21–40") return "#9ca3af";
  return "#d1d5db";
}

function fmt(n: number | null | undefined) {
  if (n == null) return null;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function salaryLabel(job: TopJob): string | null {
  if (job.salaryMin != null && job.salaryMax != null) {
    return `${fmt(job.salaryMin)}–${fmt(job.salaryMax)}`;
  }
  if (job.salaryMin != null) return `${fmt(job.salaryMin)}+`;
  if (job.estimatedSalaryMin != null) {
    const label = fmt(job.estimatedSalaryMin);
    const conf = job.salaryConfidence === "high" ? "" : "~";
    if (job.estimatedSalaryMax != null) return `${conf}${label}–${fmt(job.estimatedSalaryMax)}`;
    return `${conf}${label}+`;
  }
  return null;
}

function isEstimated(job: TopJob) {
  return job.salaryMin == null && job.estimatedSalaryMin != null;
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr.replace(" ", "T")).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function degreeLabel(deg: string | null) {
  if (!deg || deg === "none") return null;
  const map: Record<string, string> = {
    high_school: "HS",
    associate: "AA",
    bachelor: "BS",
    master: "MS",
    phd: "PhD",
  };
  return map[deg] ?? deg;
}

// ─── Score bar mini-component ─────────────────────────────────────────────────

function ScoreDots({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const pct = Math.round((value / 10) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${value >= 7 ? "bg-primary" : value >= 4 ? "bg-primary/50" : "bg-muted-foreground/30"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-4">{value}</span>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BackfillStatus {
  total: number;
  analyzed: number;
  unanalyzed: number;
  activeRun: { id: string; status: string; total: number; analyzed: number; errors: number } | null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null);
  const [backfillStarting, setBackfillStarting] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => { if (!r.ok) throw new Error("Failed to load"); return r.json(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  // Poll backfill status
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function poll() {
      fetch("/api/analysis/backfill")
        .then((r) => r.json())
        .then((d: BackfillStatus) => {
          setBackfill(d);
          if (d.activeRun) {
            timer = setTimeout(poll, 5000);
          } else if (d.unanalyzed === 0 && data) {
            // Re-fetch dashboard now that analysis completed
            fetch("/api/dashboard")
              .then((r) => r.json())
              .then(setData)
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
    poll();
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startBackfill() {
    setBackfillStarting(true);
    setBackfillError(null);
    try {
      const res = await fetch("/api/analysis/backfill", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setBackfillError(json.error ?? "Failed to start"); return; }
      // Start polling
      const poll = () =>
        fetch("/api/analysis/backfill")
          .then((r) => r.json())
          .then((d: BackfillStatus) => {
            setBackfill(d);
            if (d.activeRun) setTimeout(poll, 5000);
          })
          .catch(() => {});
      setTimeout(poll, 1000);
    } catch {
      setBackfillError("Network error — could not start backfill. Please try again.");
    } finally {
      setBackfillStarting(false);
    }
  }

  async function cancelBackfill() {
    setBackfillError(null);
    try {
      const res = await fetch("/api/analysis/backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancel: true }) });
      if (!res.ok) { setBackfillError("Could not cancel the backfill — please try again."); return; }
      fetch("/api/analysis/backfill").then((r) => r.json()).then(setBackfill).catch(() => {});
    } catch {
      setBackfillError("Network error — could not cancel the backfill. Please try again.");
    }
  }

  if (loading) {
    return <div className="flex min-h-[28rem] items-center justify-center rounded-2xl border border-dashed border-border bg-card/50"><Spinner /></div>;
  }
  if (error || !data) {
    return <div className="flex min-h-[28rem] items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5 px-6 text-center text-destructive" role="alert">{error || "No data"}</div>;
  }

  const { scrape, topJobs, scoreDistribution, recentRuns, pipeline } = data;
  const hasScrapedData = scrape.total > 0;

  return (
    <div className="space-y-7">

      {/* ── Header ── */}
      <div className="rounded-2xl border border-border bg-card px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-primary">Overview</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">See what is worth your attention, then make the next move.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/scrape"><Button size="lg">Scrape Jobs</Button></Link>
            <Link href="/analysis"><Button size="lg" variant="outline">Market Analysis</Button></Link>
          </div>
        </div>
      </div>

      {/* ── Scrape stats ── */}
      {hasScrapedData ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="text-3xl font-bold">{scrape.total.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Scraped</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-3xl font-bold">{scrape.analyzed.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">AI Analyzed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className={`text-3xl font-bold ${scrape.avgScore != null && scrape.avgScore >= 55 ? "text-primary" : ""}`}>
                  {scrape.avgScore ?? "—"}
                </div>
                <div className="text-sm text-muted-foreground">Avg Score / 100</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-3xl font-bold text-primary">{scrape.highScoreCount}</div>
                <div className="text-sm text-muted-foreground">High Score (≥70)</div>
              </CardContent>
            </Card>
          </div>

          {/* Insight chips */}
          <div className="flex flex-wrap gap-2 border-y border-border/70 py-3">
            {scrape.analyzed > 0 && (
              <>
                <Badge variant="outline" className="text-sm py-1 px-3">{scrape.remotePct}% remote-eligible</Badge>
                <Badge variant="outline" className="text-sm py-1 px-3">{scrape.noDegreePct}% no degree req</Badge>
              </>
            )}
            <Badge variant="outline" className="text-sm py-1 px-3">{scrape.salaryPct}% have salary data</Badge>
            {scrape.avgSalary && (
              <Badge variant="outline" className="text-sm py-1 px-3">avg salary floor {fmt(scrape.avgSalary)}</Badge>
            )}
            {scrape.sourceBreakdown.slice(0, 3).map((s) => (
              <Badge key={s.name} variant="secondary" className="text-xs">{s.name}: {s.count}</Badge>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <p className="text-muted-foreground">No scraped listings yet.</p>
            <Link href="/scrape"><Button>Run your first scrape</Button></Link>
          </CardContent>
        </Card>
      )}

      {/* ── Analysis backfill panel ── */}
      {backfill && backfill.unanalyzed > 0 && (
        <Card className={backfill.activeRun ? "border-primary/30 bg-accent/40" : "border-ring/40 bg-accent/20"}>
          <CardContent className="pt-4 pb-4">
            {backfill.activeRun ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Spinner className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">Analyzing jobs…</span>
                  </div>
                  <button
                    onClick={cancelBackfill}
                    className="text-xs text-muted-foreground hover:text-red-600 underline"
                  >
                    Cancel
                  </button>
                </div>
                <Progress
                  value={Math.round((backfill.activeRun.analyzed / backfill.activeRun.total) * 100)}
                  className="h-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{backfill.activeRun.analyzed.toLocaleString()} / {backfill.activeRun.total.toLocaleString()} analyzed</span>
                  {backfill.activeRun.errors > 0 && (
                    <span className="text-orange-600">{backfill.activeRun.errors} batch errors</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {backfill.unanalyzed.toLocaleString()} jobs need AI scoring
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {backfill.analyzed.toLocaleString()} of {backfill.total.toLocaleString()} analyzed · scores unlock ranking, filtering, and insights
                  </p>
                  {backfillError && <p className="text-xs text-destructive mt-1">{backfillError}</p>}
                </div>
                <Button
                  size="sm"
                  onClick={startBackfill}
                  disabled={backfillStarting}
                  className="shrink-0"
                >
                  {backfillStarting ? <Spinner className="h-4 w-4 mr-1" /> : null}
                  Analyze Jobs
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Top scored jobs + score distribution ── */}
      {hasScrapedData && (
        <div className="grid md:grid-cols-3 gap-6">

          {/* Top jobs — takes 2/3 */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Top AI-Scored Jobs</h2>
              <Link href="/scrape" className="text-xs text-muted-foreground hover:underline">
                View all scrapes →
              </Link>
            </div>

            <div className="space-y-2">
              {topJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No analyzed jobs yet — run a scrape to see results here.</p>
              ) : (
                topJobs.map((job) => {
                  const salary = salaryLabel(job);
                  const estimated = isEstimated(job);
                  const deg = degreeLabel(job.degreeRequired);
                  const isOpen = expandedJob === job.id;

                  return (
                    <div
                      key={job.id}
                      className="group overflow-hidden rounded-xl border border-border/80 bg-card transition-colors hover:border-primary/45"
                    >
                      {/* Row */}
                      <div
                        className="flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/45"
                        onClick={() => setExpandedJob(isOpen ? null : job.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpandedJob(isOpen ? null : job.id);
                          }
                        }}
                      >
                        {/* Score badge */}
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold font-mono ${scoreBg(job.rankScore)}`}>
                          {job.rankScore}
                        </span>

                        {/* Title + company */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{job.role}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {job.company}{job.location ? ` · ${job.location}` : ""}
                          </div>
                        </div>

                        {/* Right side */}
                        <div className="flex items-center gap-2 shrink-0">
                          {deg && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 text-accent-foreground border-border">
                              {deg} req
                            </Badge>
                          )}
                          {salary && (
                            <span className={`text-xs font-mono ${estimated ? "text-muted-foreground" : ""}`}>
                              {salary}{estimated ? " est." : ""}
                            </span>
                          )}
                          {job.source && (
                            <Badge variant="secondary" className="text-xs">{job.source}</Badge>
                          )}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t bg-muted/20 space-y-2">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <ScoreDots label="Pay" value={job.scorePay} />
                            <ScoreDots label="Flex" value={job.scoreFlexibility} />
                            <ScoreDots label="Location" value={job.scoreLocation} />
                            <ScoreDots label="Reqs" value={job.scoreRequirements} />
                            <ScoreDots label="Hours" value={job.scoreHours} />
                          </div>
                          {job.yearsExperience != null && (
                            <p className="text-xs text-muted-foreground">{job.yearsExperience} yr exp required</p>
                          )}
                          {job.notes && (
                            <p className="text-xs text-muted-foreground italic">{job.notes}</p>
                          )}
                          <div className="flex gap-2 pt-1">
                            {job.url && (
                              <a href={job.url} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="outline" className="text-xs h-7">View Listing</Button>
                              </a>
                            )}
                            <Link href={`/scrape?run=${job.scrapeRunId}`}>
                              <Button size="sm" variant="ghost" className="text-xs h-7">See in Scrape</Button>
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Score distribution — takes 1/3 */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Score Distribution</h2>
            <Card>
              <CardContent className="pt-4 pb-2">
                <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fit across the board</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={scoreDistribution} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => [v, "Jobs"]} />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {scoreDistribution.map((entry) => (
                        <Cell key={entry.range} fill={barColor(entry.range)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Key insight from score data */}
            {scrape.analyzed > 0 && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">High score (≥70)</span>
                  <span className="font-mono font-medium text-primary">
                    {scrape.highScoreCount} ({Math.round((scrape.highScoreCount / scrape.analyzed) * 100)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg score</span>
                  <span className="font-mono font-medium">{scrape.avgScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total analyzed</span>
                  <span className="font-mono">{scrape.analyzed}</span>
                </div>
              </div>
            )}

            {/* Recent runs */}
            {recentRuns.length > 0 && (
              <div className="pt-2 space-y-1">
                <h3 className="text-sm font-semibold">Recent Scrapes</h3>
                {recentRuns.map((run) => (
                  <div key={run.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[140px]">{run.label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono">{run.totalFound}</span>
                      <span className="text-muted-foreground">{relativeTime(run.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Application pipeline ── */}
      {(pipeline.total > 0 || pipeline.needFollowUp.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">

          {/* Pipeline stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Application Pipeline</span>
                <Link href="/jobs">
                  <Button variant="ghost" size="sm" className="text-xs h-7">View All</Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pipeline.total === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">No jobs tracked yet.</p>
                  <Link href="/jobs/new"><Button size="sm" variant="outline">Add a job</Button></Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{pipeline.totalApplied}</div>
                      <div className="text-xs text-muted-foreground">Applied</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${pipeline.activeInterviews >= 3 ? "text-primary" : ""}`}>
                        {pipeline.activeInterviews}
                      </div>
                      <div className="text-xs text-muted-foreground">Interviews</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${pipeline.offers > 0 ? "text-primary" : ""}`}>
                        {pipeline.offers}
                      </div>
                      <div className="text-xs text-muted-foreground">Offers</div>
                    </div>
                  </div>
                  {JOB_STATUSES.map((s) => {
                    const count = pipeline.statusCounts[s.value] || 0;
                    if (count === 0) return null;
                    const pct = Math.round((count / pipeline.total) * 100);
                    return (
                      <div key={s.value}>
                        <div className="flex items-center justify-between mb-0.5">
                          <Badge variant="outline" className={`text-xs ${s.color}`}>{s.label}</Badge>
                          <span className="text-xs font-mono text-muted-foreground">{count} ({pct}%)</span>
                        </div>
                        <Progress value={pct} className="h-1" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Follow-up reminders */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {pipeline.needFollowUp.length > 0 ? (
                  <span className="text-primary">Follow-Up Needed ({pipeline.needFollowUp.length})</span>
                ) : (
                  <span>Follow-Ups</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pipeline.needFollowUp.length === 0 ? (
                <p className="text-sm text-muted-foreground">No follow-ups overdue.</p>
              ) : (
                <div className="space-y-2">
                  {pipeline.needFollowUp.map((job) => (
                    <div key={job.id} className="flex items-center justify-between">
                      <Link href={`/jobs/${job.id}`} className="hover:underline text-sm truncate max-w-[200px]">
                        {job.company} — {job.role}
                      </Link>
                      <span className="text-xs text-primary shrink-0">{job.daysSince}d ago</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
