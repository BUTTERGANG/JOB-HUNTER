"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { JOB_SOURCES, JOB_TIERS, SCORE_DIMENSIONS, scoreColor } from "@/lib/constants";

export default function NewJobPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState({
    company: "",
    role: "",
    location: "",
    salaryMin: "",
    salaryMax: "",
    url: "",
    source: "",
    description: "",
    tier: "B",
    scoreRole: 0,
    scoreSkills: 0,
    scoreCompany: 0,
    scoreComp: 0,
    scoreGrowth: 0,
    recruiterName: "",
    recruiterEmail: "",
    notes: "",
  });

  const scoreTotal =
    form.scoreRole + form.scoreSkills + form.scoreCompany + form.scoreComp + form.scoreGrowth;

  function updateField(key: string, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    const payload = {
      ...form,
      salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
      salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
      scoreRole: form.scoreRole,
      scoreSkills: form.scoreSkills,
      scoreCompany: form.scoreCompany,
      scoreComp: form.scoreComp,
      scoreGrowth: form.scoreGrowth,
    };

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const job = await res.json();
        router.push(`/jobs/${job.id}`);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setSaveError(data.error || `Could not save job (${res.status}). Please try again.`);
    } catch {
      setSaveError("Network error — could not reach the server. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header className="border-b border-border/70 pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Pipeline entry
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Add Job</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Capture the details and signals you need to make a confident next move.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle>Basic Info</CardTitle>
            <p className="text-sm text-muted-foreground">Start with the role, company, and where it came from.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="company">Company *</Label>
                <Input
                  id="company"
                  value={form.company}
                  onChange={(e) => updateField("company", e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="role">Role *</Label>
                <Input
                  id="role"
                  value={form.role}
                  onChange={(e) => updateField("role", e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={form.location}
                  onChange={(e) => updateField("location", e.target.value)}
                  placeholder="Remote, NYC, etc."
                />
              </div>
              <div>
                <Label htmlFor="source">Source</Label>
                <Select
                  value={form.source}
                  onValueChange={(v) => updateField("source", v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Where did you find this?" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="salaryMin">Salary Min ($)</Label>
                <Input
                  id="salaryMin"
                  type="number"
                  value={form.salaryMin}
                  onChange={(e) => updateField("salaryMin", e.target.value)}
                  placeholder="100000"
                />
              </div>
              <div>
                <Label htmlFor="salaryMax">Salary Max ($)</Label>
                <Input
                  id="salaryMax"
                  type="number"
                  value={form.salaryMax}
                  onChange={(e) => updateField("salaryMax", e.target.value)}
                  placeholder="150000"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="url">Job URL</Label>
              <Input
                id="url"
                type="url"
                value={form.url}
                onChange={(e) => updateField("url", e.target.value)}
                placeholder="https://..."
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle>Job Description</CardTitle>
            <p className="text-sm text-muted-foreground">Paste the source description to keep your research in one place.</p>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Paste the full job description here. This is used for AI resume tailoring and JD analysis."
              rows={10}
              className="resize-none"
            />
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle className="flex items-center justify-between">
              <span>Score Card</span>
              <span className={`rounded-full bg-background px-3 py-1 text-lg font-mono ring-1 ring-border/70 ${scoreColor(scoreTotal)}`}>
                {scoreTotal}/25
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">Use the same signals across every opportunity for a clearer comparison.</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-xs text-muted-foreground -mt-2">
              Rate each dimension 0–5: 0 = no fit, 3 = acceptable, 5 = perfect match.
            </p>
            {SCORE_DIMENSIONS.map((dim) => {
              const value = form[dim.key as keyof typeof form] as number;
              return (
                <div key={dim.key}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <Label>{dim.label}</Label>
                      <p className="text-xs text-muted-foreground">
                        {dim.description}
                      </p>
                    </div>
                    <span className={`font-mono text-sm font-bold w-6 text-right ${value >= 4 ? "text-green-600" : value >= 3 ? "text-blue-600" : value > 0 ? "text-yellow-600" : "text-muted-foreground"}`}>
                      {value}
                    </span>
                  </div>
                  <Slider
                    value={[value]}
                    onValueChange={(val) => updateField(dim.key, Array.isArray(val) ? val[0] : val as number)}
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
            <div>
              <Label>Tier</Label>
              <Select
                value={form.tier}
                onValueChange={(v) => updateField("tier", v ?? "B")}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TIERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle>Recruiter & Notes</CardTitle>
            <p className="text-sm text-muted-foreground">Save context that will help when you follow up later.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="recruiterName">Recruiter Name</Label>
                <Input
                  id="recruiterName"
                  value={form.recruiterName}
                  onChange={(e) => updateField("recruiterName", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="recruiterEmail">Recruiter Email</Label>
                <Input
                  id="recruiterEmail"
                  type="email"
                  value={form.recruiterEmail}
                  onChange={(e) =>
                    updateField("recruiterEmail", e.target.value)
                  }
                />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {saveError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {saveError}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row">
          <Button type="submit" disabled={saving} className="w-full sm:w-auto">
            {saving ? "Saving..." : "Save Job"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
