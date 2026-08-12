"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

// ─── Types (mirror the analyze-url route response) ─────────────────────────────

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

interface Analysis {
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

interface AnalyzedJob {
  role: string;
  company: string;
  location: string | null;
  url: string | null;
  source: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  jobType: string | null;
  description: string | null;
}

interface AnalyzeResponse {
  job: AnalyzedJob;
  analysis: Analysis | null;
}

// ─── Helpers (shared visual language with the Scrape tab) ──────────────────────

function formatSalary(min: number | null, max: number | null) {
  if (!min && !max) return "—";
  const fmt = (n: number) => `$${(n / 1000).toFixed(0)}k`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  return min ? `${fmt(min)}+` : `≤${fmt(max!)}`;
}

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

function tierFromScore(score: number): "A" | "B" | "C" {
  if (score >= 70) return "A";
  if (score >= 40) return "B";
  return "C";
}

// ─── Analysis detail card ──────────────────────────────────────────────────────

function AnalysisCard({ job, analysis }: { job: AnalyzedJob; analysis: Analysis }) {
  const hasListedSalary = job.salaryMin != null || job.salaryMax != null;
  return (
    <div className="space-y-4">
      {/* Header: score + title */}
      <div className="flex items-start gap-4">
        <span
          className={`inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border text-xl font-bold shrink-0 ${scoreColor(analysis.rankScore)}`}
          title="Overall AI rank (0–100)"
        >
          {analysis.rankScore}
          <span className="text-[10px] font-medium opacity-70">/ 100</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight">
            {job.url ? (
              <a href={job.url} target="_blank" rel="noreferrer" className="hover:underline">
                {job.role || "Untitled role"}
              </a>
            ) : (
              job.role || "Untitled role"
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {job.company || "Unknown company"}
            {job.location ? ` · ${job.location}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm">
            <span className="font-medium">
              {hasListedSalary
                ? formatSalary(job.salaryMin, job.salaryMax)
                : analysis.estimatedSalaryMin != null || analysis.estimatedSalaryMax != null
                ? `~${formatSalary(analysis.estimatedSalaryMin, analysis.estimatedSalaryMax)}`
                : "—"}
            </span>
            {!hasListedSalary && (analysis.estimatedSalaryMin != null || analysis.estimatedSalaryMax != null) && (
              <span className="text-xs text-muted-foreground">
                AI estimate ({analysis.salaryConfidence ?? "low"} confidence)
              </span>
            )}
            {job.jobType && (
              <Badge variant="outline" className="text-xs">{job.jobType}</Badge>
            )}
            {job.source && (
              <Badge variant="secondary" className="text-xs capitalize">{job.source}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Score pills */}
      <div className="flex flex-wrap gap-2">
        <ScorePill label="Pay" value={analysis.scorePay} />
        <ScorePill label="Flexibility" value={analysis.scoreFlexibility} />
        <ScorePill label="Location" value={analysis.scoreLocation ?? 5} />
        <ScorePill label="Requirements" value={analysis.scoreRequirements} />
        <ScorePill label="Hours" value={analysis.scoreHours} />
        <ScorePill label="Workload" value={analysis.scoreResponsibilities} />
      </div>

      {/* Requirements */}
      {analysis.requirements && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="font-medium text-foreground">Degree: </span>
            <DegreeTag degree={analysis.requirements.degreeRequired} />
          </span>
          {analysis.requirements.yearsExperience != null && (
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">Exp: </span>
              {analysis.requirements.yearsExperience === 0
                ? "None required"
                : `${analysis.requirements.yearsExperience}+ yrs`}
            </span>
          )}
          {analysis.requirements.certificationsRequired.length > 0 && (
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">Certs: </span>
              {analysis.requirements.certificationsRequired.join(", ")}
            </span>
          )}
          {analysis.requirements.backgroundCheckRequired != null && (
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">BG Check: </span>
              {analysis.requirements.backgroundCheckRequired ? "Required" : "Not mentioned"}
            </span>
          )}
          {analysis.requirements.locationArea && analysis.requirements.locationArea !== "Unspecified" && (
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">Area: </span>
              {analysis.requirements.locationArea}
            </span>
          )}
        </div>
      )}

      {/* Schedule */}
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Schedule: </span>
        {formatSchedule(analysis.schedule)}
      </div>

      {/* Benefits */}
      {analysis.benefits.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs font-medium text-foreground mr-1">Benefits:</span>
          {analysis.benefits.map((b) => (
            <Badge key={b} variant="secondary" className="text-xs">{b}</Badge>
          ))}
        </div>
      )}

      {/* BLS Indiana wage benchmark */}
      {analysis.blsWage && (
        <div className="text-xs">
          <span className="font-medium text-foreground">
            BLS Indiana ({analysis.blsWage.dataYear}):{" "}
          </span>
          <span className="text-blue-700 dark:text-blue-400 font-medium">
            Median {analysis.blsWage.aMedian ? `$${(analysis.blsWage.aMedian / 1000).toFixed(0)}k` : "—"}
          </span>
          {analysis.blsWage.aPct25 && analysis.blsWage.aPct75 && (
            <span className="text-muted-foreground">
              {" "}· 25th ${(analysis.blsWage.aPct25 / 1000).toFixed(0)}k
              {" "}· 75th ${(analysis.blsWage.aPct75 / 1000).toFixed(0)}k
            </span>
          )}
          {analysis.socCode && (
            <span className="text-muted-foreground/50 ml-1.5">
              ({analysis.socCode} · {analysis.blsWage.occTitle})
            </span>
          )}
        </div>
      )}

      {/* Notes */}
      {analysis.notes && <p className="text-sm text-muted-foreground italic">{analysis.notes}</p>}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

type Phase = "idle" | "analyzing" | "done" | "error";
type SaveState = "idle" | "saving" | "saved" | "duplicate" | "error";

export default function AnalyzeJobPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedJobId, setSavedJobId] = useState<number | null>(null);

  async function analyze() {
    if (!url.trim() && !manualText.trim()) {
      setError("Enter a job URL, or paste a job description.");
      setPhase("error");
      return;
    }
    setPhase("analyzing");
    setError(null);
    setResult(null);
    setSaveState("idle");
    setSavedJobId(null);

    try {
      const res = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          description: manualText.trim() || undefined,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.needsManual) setManualOpen(true);
        setError(data.error || "Analysis failed.");
        setPhase("error");
        return;
      }
      setResult(data);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request timed out or failed.");
      setPhase("error");
    }
  }

  async function saveJob() {
    if (!result?.analysis) return;
    const { job, analysis } = result;
    setSaveState("saving");

    // Per product decision: fall back to the AI's Indianapolis estimate when the
    // posting listed no salary; carry the rank into the job's total score, and
    // fold the AI note + estimate into the job's notes.
    const salaryMin = job.salaryMin ?? analysis.estimatedSalaryMin ?? null;
    const salaryMax = job.salaryMax ?? analysis.estimatedSalaryMax ?? null;
    const estNote =
      job.salaryMin == null && job.salaryMax == null &&
      (analysis.estimatedSalaryMin != null || analysis.estimatedSalaryMax != null)
        ? ` Salary is an AI estimate (${analysis.salaryConfidence ?? "low"} confidence).`
        : "";
    const notes = `${analysis.notes ?? ""} (AI rank ${analysis.rankScore}/100.${estNote})`.trim();

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: job.company,
          role: job.role,
          location: job.location,
          url: job.url,
          source: job.source,
          description: job.description,
          salaryMin,
          salaryMax,
          status: "saved",
          tier: tierFromScore(analysis.rankScore),
          scoreTotal: analysis.rankScore,
          notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSavedJobId(data.existingJobId ?? null);
        setSaveState("duplicate");
        return;
      }
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      setSavedJobId(data.id ?? null);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Analyze Job</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Drop in a link to a single job posting and get the same AI fit analysis the Scrape tab
        produces — then save it straight to your tracker.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Job posting URL</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && phase !== "analyzing") analyze(); }}
              placeholder="https://…  (paste a job link)"
              className="flex-1"
            />
            <Button onClick={analyze} disabled={phase === "analyzing"}>
              {phase === "analyzing" ? "Analyzing…" : "Analyze"}
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {manualOpen ? "▲ Hide manual paste" : "▼ Some sites (LinkedIn, Indeed) block fetching — paste the description manually"}
          </button>

          {manualOpen && (
            <Textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Paste the full job description here. If a URL is also filled in, the pasted text is used."
              rows={8}
            />
          )}
        </CardContent>
      </Card>

      {phase === "analyzing" && (
        <div className="flex items-center justify-center h-40">
          <Spinner />
        </div>
      )}

      {phase === "error" && error && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {phase === "done" && result && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            {result.analysis ? (
              <>
                <AnalysisCard job={result.job} analysis={result.analysis} />
                <div className="flex items-center gap-3 pt-2 border-t">
                  {saveState === "saved" ? (
                    <>
                      <span className="text-sm font-medium text-green-600 dark:text-green-400">✓ Saved to tracker</span>
                      <Button variant="outline" size="sm" onClick={() => router.push("/jobs")}>
                        View Jobs
                      </Button>
                    </>
                  ) : saveState === "duplicate" ? (
                    <>
                      <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Already in your tracker</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(savedJobId ? `/jobs/${savedJobId}` : "/jobs")}
                      >
                        View
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={saveJob} disabled={saveState === "saving"}>
                        {saveState === "saving" ? "Saving…" : "Save to Jobs"}
                      </Button>
                      {saveState === "error" && (
                        <span className="text-sm text-red-500">Save failed — try again.</span>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The posting was read but the AI analysis came back empty. Check that your Anthropic
                API key is set in Settings and try again.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
