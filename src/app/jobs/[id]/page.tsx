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
  const [tailoredResume, setTailoredResume] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

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
      .then((data) => { if (data) setAnalysis(data); });

    fetch(`/api/jobs/${id}/resume`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.content) setTailoredResume(data.content); });
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
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: job.description, jobId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysis(data);
      } else {
        alert(data.error || "Analysis failed");
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function tailorResume() {
    if (!job?.description) return;
    setTailoring(true);
    try {
      const res = await fetch("/api/ai/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: job.description, jobId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setTailoredResume(data.content);
      } else {
        alert(data.error || "Tailoring failed");
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
          <h1 className="text-2xl font-bold">
            {job.role} at {job.company}
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
                    <Button variant="outline" size="sm" onClick={startEdit}>Edit</Button>
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
                    {job.description ? (
                      <div className="whitespace-pre-wrap text-sm">{job.description}</div>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No description added. Click Edit to paste the JD for AI features.
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
              {analysis && (
                <div className="space-y-6">
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
                  {tailoredResume && (
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
                      <div
                        id="resume-preview"
                        className="prose prose-sm max-w-none p-6 bg-white border rounded-lg"
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {tailoredResume}
                        </ReactMarkdown>
                      </div>
                    </TabsContent>
                    <TabsContent value="edit">
                      <Textarea
                        value={tailoredResume}
                        onChange={(e) => setTailoredResume(e.target.value)}
                        rows={30}
                        className="font-mono text-sm"
                      />
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
