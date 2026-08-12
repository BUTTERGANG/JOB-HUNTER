"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  JOB_STATUSES,
  JOB_TIERS,
  JOB_SOURCES,
  SCORE_DIMENSIONS,
  LISTING_STATUS_BADGE,
  scoreColor,
} from "@/lib/constants";
import type { Job } from "@/lib/db/schema";
import { Spinner } from "@/components/ui/spinner";

interface Analysis {
  keywords: string[];
  fitScore: number;
  redFlags: string[];
  mustHave: string[];
  niceToHave: string[];
  questions: string[];
}

interface RankAnalysis {
  rankScore: number;
  scorePay: number;
  scoreFlexibility: number;
  scoreLocation: number;
  scoreRequirements: number;
  scoreHours: number;
  scoreResponsibilities: number;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: "high" | "medium" | "low" | null;
  socCode: string | null;
  blsWage: {
    occTitle: string;
    aMedian: number | null;
    aPct25: number | null;
    aPct75: number | null;
    aMean: number | null;
    dataYear: number;
  } | null;
}

interface ResumeStructure {
  name: string;
  tagline: string;
  contact: {
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
    portfolio?: string;
  };
  professionalSummary: string;
  coreCompetencies: {
    technical: string[];
    operations: string[];
    leadership: string[];
  };
  professionalExperience: {
    title: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    bullets: string[];
  }[];
  technicalProficiencies: string[];
  certifications: string[];
}

type TailoredResumeData = ResumeStructure | string;

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rankAnalysis, setRankAnalysis] = useState<RankAnalysis | null>(null);
  const [tailoredResume, setTailoredResume] = useState<TailoredResumeData>("");
  const [isLegacyFormat, setIsLegacyFormat] = useState(false);
  const [resumeDirty, setResumeDirty] = useState(false);
  const [savingResume, setSavingResume] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [fetchingDesc, setFetchingDesc] = useState(false);
  const [fetchDescMsg, setFetchDescMsg] = useState<string | null>(null);
  const [checkingListing, setCheckingListing] = useState(false);
  const [tailorError, setTailorError] = useState<{ message: string; needsResume: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/jobs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Job not found");
        return r.json();
      })
      .then(setJob)
      .catch(() => setError("Job not found"));

    fetch(`/api/jobs/${id}/analysis`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setAnalysis(data); })
      // Analysis is optional secondary data; a failure just means none is shown.
      .catch(() => {});

    fetch(`/api/jobs/${id}/resume`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.content) {
          const content = data.content;
          // The DB always hands back content as a string. Parse it so that a
          // structured résumé is held in state as an OBJECT (matching what
          // tailorResume() produces) — the structured preview and Edit tab both
          // assume an object. Legacy markdown stays a string.
          try {
            const parsed = typeof content === "string" ? JSON.parse(content) : content;
            if (parsed && typeof parsed === "object" && parsed.professionalSummary) {
              setTailoredResume(parsed);
              setIsLegacyFormat(false);
            } else {
              setTailoredResume(content);
              setIsLegacyFormat(true);
            }
          } catch {
            // Not JSON → legacy markdown string
            setTailoredResume(content);
            setIsLegacyFormat(true);
          }
          setResumeDirty(false);
        }
      })
      // Saved résumé is optional; a failure just means none is preloaded.
      .catch(() => {});
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-muted-foreground">{error}</div>
        <Link href="/jobs"><Button variant="outline">Back to Jobs</Button></Link>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  const statusInfo = JOB_STATUSES.find((s) => s.value === job.status) || JOB_STATUSES[0];
  const tierInfo = JOB_TIERS.find((t) => t.value === job.tier) || JOB_TIERS[1];

  async function updateField(field: string, value: string | number | null) {
    const updates: Record<string, string | number | null> = { [field]: value };
    if (field === "status" && value === "applied" && !job?.dateApplied) {
      updates.dateApplied = new Date().toISOString().split("T")[0];
    }

    const res = await fetch(`/api/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setJob(updated);
    }
  }

  async function updateScore(key: string, value: number) {
    await updateField(key, value);
  }

  function startEdit() {
    if (!job) return;
    setEditForm({
      company: job.company,
      role: job.role,
      location: job.location || "",
      salaryMin: job.salaryMin?.toString() || "",
      salaryMax: job.salaryMax?.toString() || "",
      url: job.url || "",
      source: job.source || "",
      description: job.description || "",
      recruiterName: job.recruiterName || "",
      recruiterEmail: job.recruiterEmail || "",
      notes: job.notes || "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: editForm.company,
        role: editForm.role,
        location: editForm.location || null,
        salaryMin: editForm.salaryMin ? Number(editForm.salaryMin) : null,
        salaryMax: editForm.salaryMax ? Number(editForm.salaryMax) : null,
        url: editForm.url || null,
        source: editForm.source || null,
        description: editForm.description || null,
        recruiterName: editForm.recruiterName || null,
        recruiterEmail: editForm.recruiterEmail || null,
        notes: editForm.notes || null,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setJob(updated);
      setEditing(false);
    }
  }

  async function analyzeJD() {
    if (!job?.description) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: job.description, jobId: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAnalysis(data);
        // Handle rank analysis from response - refetch job for updated scores
        if (data.rankAnalysis) {
          setRankAnalysis(data.rankAnalysis);
          // Refetch job to get the updated scores and scoreTotal from DB
          fetch(`/api/jobs/${job.id}`).then(r => r.ok && r.json()).then(setJob).catch(() => {});
        }
      } else {
        setAnalyzeError(data.error || `Analysis failed (${res.status}). Please try again.`);
      }
    } catch {
      setAnalyzeError("Network error — could not reach the server. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function fetchDescription() {
    if (!job?.url) return;
    setFetchingDesc(true);
    setFetchDescMsg(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/fetch-description`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setJob((prev) =>
          prev ? { ...prev, description: data.description, company: data.company ?? prev.company } : prev
        );
        setFetchDescMsg("✓ Description fetched from the posting.");
      } else {
        setFetchDescMsg(
          data.needsManual
            ? `${data.error} (Use Edit below to paste it.)`
            : data.error || "Couldn't fetch the description."
        );
      }
    } catch {
      setFetchDescMsg("Couldn't reach the posting. Paste the description manually with Edit.");
    } finally {
      setFetchingDesc(false);
    }
  }

  async function recheckListing() {
    if (!job?.url) return;
    setCheckingListing(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/check-listing`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setJob((prev) =>
          prev ? { ...prev, listingStatus: data.listingStatus, listingCheckedAt: data.listingCheckedAt } : prev
        );
      }
    } finally {
      setCheckingListing(false);
    }
  }

  async function tailorResume() {
    if (!job?.description) return;
    setTailoring(true);
    setTailorError(null);
    try {
      const res = await fetch("/api/ai/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: job.description, jobId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const content = data.content;
        setTailoredResume(content);
        // Check if this is legacy markdown format
        if (typeof content === "string" || data.isLegacy) {
          setIsLegacyFormat(true);
        } else {
          setIsLegacyFormat(false);
        }
        setResumeDirty(false);
      } else {
        const message = data.error || "Tailoring failed";
        setTailorError({ message, needsResume: /master resume/i.test(message) });
      }
    } finally {
      setTailoring(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    router.push("/jobs");
  }

  async function saveResumeEdits() {
    if (!job || !tailoredResume) return;
    setSavingResume(true);
    try {
      const contentToSave = typeof tailoredResume === "string"
        ? tailoredResume
        : JSON.stringify(tailoredResume);
      const res = await fetch(`/api/jobs/${job.id}/resume`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentToSave }),
      });
      if (res.ok) setResumeDirty(false);
    } finally {
      setSavingResume(false);
    }
  }

  async function exportPdf() {
    if (!tailoredResume || !job) return;
    const html2pdf = (await import("html2pdf.js")).default;
    const el = document.getElementById("resume-preview");
    if (!el) return;
    html2pdf()
      .set({
        margin: [10, 15],
        filename: `Resume_${job.company}_${job.role}.pdf`.replace(/\s+/g, "_"),
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4" },
      })
      .from(el)
      .save();
  }

  const formatSalary = (n: number) => `$${n.toLocaleString()}`;

  // Score pill helper for rank analysis display
  const ScorePill = ({ value }: { value: number }) => {
    const color = value >= 7
      ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border-green-200 dark:border-green-800"
      : value >= 4
      ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800"
      : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800";
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${color}`}>
        <span className="font-bold">{value}/10</span>
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/jobs" className="text-sm text-muted-foreground hover:underline">
              Jobs
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground truncate max-w-[240px]">
              {job.role} at {job.company}
            </span>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {job.role} at {job.company}
            {LISTING_STATUS_BADGE[job.listingStatus ?? ""] && (
              <Badge variant="outline" className={LISTING_STATUS_BADGE[job.listingStatus ?? ""]!.color}>
                {LISTING_STATUS_BADGE[job.listingStatus ?? ""]!.label}
              </Badge>
            )}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            {job.location && (
              <span className="text-sm text-muted-foreground">{job.location}</span>
            )}
            {(job.salaryMin || job.salaryMax) && (
              <span className="text-sm text-muted-foreground">
                {job.salaryMin && job.salaryMax
                  ? `${formatSalary(job.salaryMin)} - ${formatSalary(job.salaryMax)}`
                  : formatSalary(job.salaryMin || job.salaryMax!)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                View Listing
              </Button>
            </a>
          )}
          {job.url && (
            <Button
              variant="outline"
              size="sm"
              onClick={recheckListing}
              disabled={checkingListing}
              title={job.listingCheckedAt ? `Last checked ${new Date(job.listingCheckedAt).toLocaleString()}` : undefined}
            >
              {checkingListing ? "Checking…" : "Recheck listing"}
            </Button>
          )}
          {deleteConfirm ? (
            <>
              <span className="text-sm text-muted-foreground hidden sm:inline">Delete this job?</span>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Confirm"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={job.status} onValueChange={(v) => v && updateField("status", v)}>
              <SelectTrigger className="mt-1">
                <Badge variant="outline" className={statusInfo.color}>
                  {statusInfo.label}
                </Badge>
              </SelectTrigger>
              <SelectContent>
                {JOB_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <Label className="text-xs text-muted-foreground">Tier</Label>
            <Select value={job.tier || "B"} onValueChange={(v) => v && updateField("tier", v)}>
              <SelectTrigger className="mt-1">
                <Badge variant="outline" className={tierInfo.color}>
                  {tierInfo.label}
                </Badge>
              </SelectTrigger>
              <SelectContent>
                {JOB_TIERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <Label className="text-xs text-muted-foreground">Score</Label>
            <div className={`text-2xl font-mono font-bold mt-1 ${scoreColor(job.scoreTotal)}`}>
              {job.scoreTotal != null ? `${job.scoreTotal}/25` : "Not scored"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="analysis">AI Analysis</TabsTrigger>
          <TabsTrigger value="resume">Resume Tailor</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{editing ? "Edit Job" : "Job Description"}</span>
                  {!editing && (
                    <div className="flex gap-2">
                      {!job.description && job.url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={fetchDescription}
                          disabled={fetchingDesc}
                          title="Fetch the description from the posting URL"
                        >
                          {fetchingDesc ? "Fetching…" : "Fetch from URL"}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {editing ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Company</Label>
                        <Input value={editForm.company} onChange={(e) => setEditForm(f => ({ ...f, company: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Role</Label>
                        <Input value={editForm.role} onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Location</Label>
                        <Input value={editForm.location} onChange={(e) => setEditForm(f => ({ ...f, location: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Source</Label>
                        <Select value={editForm.source || undefined} onValueChange={(v) => setEditForm(f => ({ ...f, source: v ?? "" }))}>
                          <SelectTrigger>
                            <SelectValue placeholder="Source" />
                          </SelectTrigger>
                          <SelectContent>
                            {JOB_SOURCES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Salary Min ($)</Label>
                        <Input type="number" value={editForm.salaryMin} onChange={(e) => setEditForm(f => ({ ...f, salaryMin: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Salary Max ($)</Label>
                        <Input type="number" value={editForm.salaryMax} onChange={(e) => setEditForm(f => ({ ...f, salaryMax: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <Label>Job URL</Label>
                      <Input value={editForm.url} onChange={(e) => setEditForm(f => ({ ...f, url: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Textarea value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} rows={10} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Recruiter Name</Label>
                        <Input value={editForm.recruiterName} onChange={(e) => setEditForm(f => ({ ...f, recruiterName: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Recruiter Email</Label>
                        <Input type="email" value={editForm.recruiterEmail} onChange={(e) => setEditForm(f => ({ ...f, recruiterEmail: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <Label>Notes</Label>
                      <Textarea value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={saveEdit}>Save Changes</Button>
                      <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {fetchDescMsg && (
                      <p className="text-xs mb-2 text-muted-foreground">{fetchDescMsg}</p>
                    )}
                    {job.description ? (
                      <div className="whitespace-pre-wrap text-sm">{job.description}</div>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No description added.{" "}
                        {job.url
                          ? "Use “Fetch from URL” above, or click Edit to paste the JD."
                          : "Click Edit to paste the JD for AI features."}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            {!editing && (job.recruiterName || job.recruiterEmail || job.notes) && (
              <Card>
                <CardHeader>
                  <CardTitle>Notes & Contact</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {job.recruiterName && (
                    <div>
                      <strong>Recruiter:</strong> {job.recruiterName}
                    </div>
                  )}
                  {job.recruiterEmail && (
                    <div>
                      <strong>Email:</strong>{" "}
                      <a href={`mailto:${job.recruiterEmail}`} className="text-blue-600 hover:underline">
                        {job.recruiterEmail}
                      </a>
                    </div>
                  )}
                  {job.notes && (
                    <div className="whitespace-pre-wrap mt-2">{job.notes}</div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="scores">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Score Card</span>
                <span className={`text-lg font-mono ${scoreColor(job.scoreTotal)}`}>
                  {job.scoreTotal ?? 0}/25
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-xs text-muted-foreground -mt-2">
                Rate each dimension 0–5: 0 = no fit, 3 = acceptable, 5 = perfect match.
              </p>
              {SCORE_DIMENSIONS.map((dim) => {
                const key = dim.key as keyof Job;
                const value = (job[key] as number) ?? 0;
                return (
                  <div key={dim.key}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <Label>{dim.label}</Label>
                        <p className="text-xs text-muted-foreground">{dim.description}</p>
                      </div>
                      <span className={`font-mono text-sm font-bold w-6 text-right ${value >= 4 ? "text-green-600" : value >= 3 ? "text-blue-600" : value > 0 ? "text-yellow-600" : "text-muted-foreground"}`}>
                        {value}
                      </span>
                    </div>
                    <Slider
                      value={[value]}
                      onValueChange={(val) => updateScore(dim.key, Array.isArray(val) ? val[0] : val as number)}
                      min={0}
                      max={5}
                      step={1}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1.5 px-px">
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <span key={n}>{n}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>JD Analysis</span>
                <Button
                  onClick={analyzeJD}
                  disabled={analyzing || !job.description}
                  size="sm"
                >
                  {analyzing ? "Analyzing..." : analysis ? "Re-Analyze" : "Analyze JD"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!job.description && (
                <p className="text-muted-foreground text-sm">
                  Add a job description in the Details tab to enable AI analysis.
                </p>
              )}
              {analyzeError && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                  {analyzeError}
                </div>
              )}
              {analysis && (
                <div className="space-y-6">
                  {/* Rank Analysis Header - shows score + estimated salary */}
                  {rankAnalysis && (
                    <div className="flex items-center gap-6 p-4 bg-muted/30 rounded-lg">
                      <div className="text-center">
                        <span className={`inline-flex flex-col items-center justify-center w-16 h-16 rounded-lg border text-xl font-bold ${scoreColor(rankAnalysis.rankScore)}`}>
                          {rankAnalysis.rankScore}
                          <span className="text-[10px] font-medium opacity-70">/ 100</span>
                        </span>
                        <span className="text-xs text-muted-foreground mt-1 block">AI Rank</span>
                      </div>
                      <div className="flex-1 grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Pay</span>
                          <ScorePill value={rankAnalysis.scorePay} />
                        </div>
                        <div>
                          <span className="text-muted-foreground">Flexibility</span>
                          <ScorePill value={rankAnalysis.scoreFlexibility} />
                        </div>
                        <div>
                          <span className="text-muted-foreground">Location</span>
                          <ScorePill value={rankAnalysis.scoreLocation} />
                        </div>
                        <div>
                          <span className="text-muted-foreground">Requirements</span>
                          <ScorePill value={rankAnalysis.scoreRequirements} />
                        </div>
                        <div>
                          <span className="text-muted-foreground">Hours</span>
                          <ScorePill value={rankAnalysis.scoreHours} />
                        </div>
                        <div>
                          <span className="text-muted-foreground">Workload</span>
                          <ScorePill value={rankAnalysis.scoreResponsibilities} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {rankAnalysis.estimatedSalaryMin != null || rankAnalysis.estimatedSalaryMax != null
                            ? `$${((rankAnalysis.estimatedSalaryMin ?? rankAnalysis.estimatedSalaryMax ?? 0) / 1000).toFixed(0)}k`
                            : "—"}
                          {rankAnalysis.estimatedSalaryMax != null && rankAnalysis.estimatedSalaryMin != null
                            ? ` – $${(rankAnalysis.estimatedSalaryMax / 1000).toFixed(0)}k`
                            : rankAnalysis.estimatedSalaryMax != null
                              ? ` (up to ${(rankAnalysis.estimatedSalaryMax / 1000).toFixed(0)}k)`
                              : ""}
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${rankAnalysis.salaryConfidence === "high" ? "bg-green-100 text-green-700" : rankAnalysis.salaryConfidence === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                          {rankAnalysis.salaryConfidence ?? "low"} confidence
                        </span>
                        {rankAnalysis.blsWage && (
                          <div className="text-xs text-muted-foreground mt-1">
                            BLS: {rankAnalysis.blsWage.occTitle} • {rankAnalysis.blsWage.aMedian
                              ? `$${(rankAnalysis.blsWage.aMedian / 1000).toFixed(0)}k median`
                              : "median: —"}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div
                        className={`text-3xl font-bold ${
                          analysis.fitScore >= 80
                            ? "text-green-600"
                            : analysis.fitScore >= 60
                            ? "text-blue-600"
                            : analysis.fitScore >= 40
                            ? "text-yellow-600"
                            : "text-red-600"
                        }`}
                      >
                        {analysis.fitScore}%
                      </div>
                      <div className="text-xs text-muted-foreground">Fit Score</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">ATS Keywords</h4>
                    <div className="flex flex-wrap gap-2">
                      {analysis.keywords.map((kw, i) => (
                        <Badge key={i} variant="secondary">
                          {kw}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-2 text-green-700">Must Have</h4>
                      <ul className="space-y-1 text-sm">
                        {analysis.mustHave.map((item, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2 text-blue-700">Nice to Have</h4>
                      <ul className="space-y-1 text-sm">
                        {analysis.niceToHave.map((item, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {analysis.redFlags.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 text-red-700">Red Flags</h4>
                      <ul className="space-y-1 text-sm">
                        {analysis.redFlags.map((flag, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            {flag}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <h4 className="font-medium mb-2">Interview Questions to Ask</h4>
                    <ul className="space-y-1 text-sm">
                      {analysis.questions.map((q, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-muted-foreground">{i + 1}.</span>
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resume">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Tailored Resume</span>
                <div className="flex gap-2">
                  <Button
                    onClick={tailorResume}
                    disabled={tailoring || !job.description}
                    size="sm"
                  >
                    {tailoring
                      ? "Generating..."
                      : tailoredResume
                      ? "Re-Generate"
                      : "Generate Resume"}
                  </Button>
                  {tailoredResume && !isLegacyFormat && (
                    <a href={`/api/jobs/${id}/resume/docx`} download>
                      <Button variant="outline" size="sm">
                        Download DOCX
                      </Button>
                    </a>
                  )}
                  {tailoredResume && isLegacyFormat && (
                    <Button onClick={exportPdf} variant="outline" size="sm">
                      Export PDF
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!job.description && (
                <p className="text-muted-foreground text-sm">
                  Add a job description in the Details tab to enable resume tailoring.
                </p>
              )}
              {tailorError && (
                <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
                  {tailorError.message}
                  {tailorError.needsResume && (
                    <>
                      {" "}
                      <Link href="/settings" className="font-medium underline">
                        Add your master résumé in Settings
                      </Link>
                      .
                    </>
                  )}
                </div>
              )}
              {tailoring && (
                <div className="flex items-center justify-center py-12 gap-3">
                  <Spinner />
                  <div className="text-muted-foreground">
                    Generating tailored resume with Claude...
                  </div>
                </div>
              )}
              {tailoredResume && !tailoring && (
                <div className="space-y-4">
                  <Tabs defaultValue="preview">
                    <TabsList>
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                      <TabsTrigger value="edit">Edit</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview">
                      {isLegacyFormat ? (
                        <div
                          id="resume-preview"
                          className="prose prose-sm max-w-none p-6 bg-white text-neutral-900 border rounded-lg"
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {tailoredResume as string}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        (() => {
                          // Structured résumés come straight from the model, so a
                          // field can be missing. Read defensively — a partial
                          // object must never crash the whole page.
                          const r = tailoredResume as Partial<ResumeStructure>;
                          const cc = r.coreCompetencies ?? { technical: [], operations: [], leadership: [] };
                          const experience = r.professionalExperience ?? [];
                          const techProf = r.technicalProficiencies ?? [];
                          const certs = r.certifications ?? [];
                          return (
                          <div className="p-6 bg-white text-neutral-900 border rounded-lg space-y-4">
                          <div className="text-center">
                            <h1 className="text-2xl font-bold">{r.name}</h1>
                            <p className="text-sm text-neutral-500 italic">
                              {r.tagline}
                            </p>
                            <p className="text-xs mt-1">
                              {Object.values(r.contact ?? {}).filter(Boolean).join(" | ")}
                            </p>
                          </div>

                          <div>
                            <h2 className="text-base font-bold border-b pb-1">PROFESSIONAL SUMMARY</h2>
                            <p className="text-sm mt-2">{r.professionalSummary}</p>
                          </div>

                          <div>
                            <h2 className="text-base font-bold border-b pb-1">CORE COMPETENCIES</h2>
                            <div className="mt-2 space-y-1 text-sm">
                              {(cc.technical?.length ?? 0) > 0 && (
                                <p><strong>Technical:</strong> {cc.technical.join(", ")}</p>
                              )}
                              {(cc.operations?.length ?? 0) > 0 && (
                                <p><strong>Operations:</strong> {cc.operations.join(", ")}</p>
                              )}
                              {(cc.leadership?.length ?? 0) > 0 && (
                                <p><strong>Leadership:</strong> {cc.leadership.join(", ")}</p>
                              )}
                            </div>
                          </div>

                          <div>
                            <h2 className="text-base font-bold border-b pb-1">PROFESSIONAL EXPERIENCE</h2>
                            <div className="mt-2 space-y-3">
                              {experience.map((exp, i) => (
                                <div key={i}>
                                  <p className="text-sm font-semibold">
                                    {exp.title} | {exp.company} | {exp.location}{" "}
                                    <span className="float-right font-normal">
                                      {exp.startDate} – {exp.endDate}
                                    </span>
                                  </p>
                                  <ul className="ml-4 mt-1 space-y-1 text-sm">
                                    {(exp.bullets ?? []).map((b, j) => (
                                      <li key={j} className="flex">
                                        <span className="mr-1">•</span>
                                        <span>{b}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          </div>

                          {techProf.length > 0 && (
                            <div>
                              <h2 className="text-base font-bold border-b pb-1">TECHNICAL PROFICIENCIES</h2>
                              <p className="text-sm mt-2">{techProf.join(", ")}</p>
                            </div>
                          )}

                          {certs.length > 0 && (
                            <div>
                              <h2 className="text-base font-bold border-b pb-1">CERTIFICATIONS & ACHIEVEMENTS</h2>
                              <ul className="ml-4 mt-2 space-y-1 text-sm">
                                {certs.map((c, i) => (
                                  <li key={i}>• {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          </div>
                          );
                        })()
                      )}
                    </TabsContent>
                    <TabsContent value="edit">
                      {isLegacyFormat ? (
                        <Textarea
                          value={tailoredResume as string}
                          onChange={(e) => { setTailoredResume(e.target.value); setResumeDirty(true); }}
                          rows={30}
                          className="font-mono text-sm"
                        />
                      ) : (
                        <Textarea
                          value={JSON.stringify(tailoredResume, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              setTailoredResume(parsed);
                            } catch {
                              // If invalid JSON, keep as string and show error
                              setTailoredResume(e.target.value);
                            }
                            setResumeDirty(true);
                          }}
                          rows={30}
                          className="font-mono text-sm"
                        />
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <Button
                          onClick={saveResumeEdits}
                          disabled={savingResume || !resumeDirty}
                          size="sm"
                        >
                          {savingResume ? "Saving…" : resumeDirty ? "Save Edits" : "Saved"}
                        </Button>
                        {resumeDirty && (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            Unsaved changes — save to keep them after leaving this page.
                          </span>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
