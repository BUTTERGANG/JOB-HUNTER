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

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const job = await res.json();
      router.push(`/jobs/${job.id}`);
    } else {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Add Job</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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

        <Card>
          <CardHeader>
            <CardTitle>Job Description</CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Score Card</span>
              <span className={`text-lg font-mono ${scoreColor(scoreTotal)}`}>
                {scoreTotal}/25
              </span>
            </CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle>Recruiter & Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Job"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
