"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { JOB_STATUSES, SCORE_DIMENSIONS, scoreColor } from "@/lib/constants";
import { Spinner } from "@/components/ui/spinner";

interface Job {
  id: number;
  company: string;
  role: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: string;
  tier: string | null;
  scoreRole: number | null;
  scoreSkills: number | null;
  scoreCompany: number | null;
  scoreComp: number | null;
  scoreGrowth: number | null;
  scoreTotal: number | null;
  source: string | null;
  description: string | null;
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Spinner /></div>}>
      <CompareContent />
    </Suspense>
  );
}

function CompareContent() {
  const searchParams = useSearchParams();
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((data) => {
        setAllJobs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ids = searchParams.get("ids");
    if (ids) {
      setSelectedIds(ids.split(",").map(Number).filter(Boolean));
    }
  }, [searchParams]);

  const selectedJobs = allJobs.filter((j) => selectedIds.includes(j.id));

  function toggleJob(id: number) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  const formatSalary = (n: number | null) => (n ? `$${(n / 1000).toFixed(0)}k` : "-");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Compare Jobs</h1>

      {allJobs.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No jobs to compare. <Link href="/jobs/new" className="underline">Add some first.</Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Select Jobs to Compare (max 3)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {allJobs.map((job) => (
                  <Button
                    key={job.id}
                    variant={selectedIds.includes(job.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleJob(job.id)}
                    disabled={!selectedIds.includes(job.id) && selectedIds.length >= 3}
                  >
                    {job.company} - {job.role}
                  </Button>
                ))}
              </div>
              {selectedJobs.length < 2 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Select at least 2 jobs above to see a side-by-side comparison.
                </p>
              )}
            </CardContent>
          </Card>

          {selectedJobs.length >= 2 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 pr-4 font-medium text-muted-foreground w-40"></th>
                    {selectedJobs.map((job) => (
                      <th key={job.id} className="text-left py-3 px-4 font-medium min-w-[200px]">
                        <Link href={`/jobs/${job.id}`} className="hover:underline">
                          {job.company}
                        </Link>
                        <div className="text-xs text-muted-foreground font-normal">
                          {job.role}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-3 pr-4 text-muted-foreground">Location</td>
                    {selectedJobs.map((job) => (
                      <td key={job.id} className="py-3 px-4">{job.location || "-"}</td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-3 pr-4 text-muted-foreground">Salary Range</td>
                    {selectedJobs.map((job) => (
                      <td key={job.id} className="py-3 px-4">
                        {job.salaryMin || job.salaryMax
                          ? `${formatSalary(job.salaryMin)} - ${formatSalary(job.salaryMax)}`
                          : "-"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-3 pr-4 text-muted-foreground">Status</td>
                    {selectedJobs.map((job) => {
                      const si = JOB_STATUSES.find((s) => s.value === job.status);
                      return (
                        <td key={job.id} className="py-3 px-4">
                          <Badge variant="outline" className={si?.color}>
                            {si?.label}
                          </Badge>
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b bg-muted/50">
                    <td className="py-3 pr-4 font-medium">Total Score</td>
                    {selectedJobs.map((job) => (
                      <td key={job.id} className="py-3 px-4">
                        <span className={`font-mono font-bold ${scoreColor(job.scoreTotal)}`}>
                          {job.scoreTotal ?? "-"}/25
                        </span>
                      </td>
                    ))}
                  </tr>
                  {SCORE_DIMENSIONS.map((dim) => (
                    <tr key={dim.key} className="border-b">
                      <td className="py-3 pr-4 text-muted-foreground text-xs">{dim.label}</td>
                      {selectedJobs.map((job) => {
                        const value = job[dim.key as keyof Job] as number | null;
                        return (
                          <td key={job.id} className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Progress value={(value ?? 0) * 20} className="h-2 w-16" />
                              <span className="font-mono text-xs">{value ?? "-"}/5</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-b">
                    <td className="py-3 pr-4 text-muted-foreground">Source</td>
                    {selectedJobs.map((job) => (
                      <td key={job.id} className="py-3 px-4">{job.source || "-"}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

        </>
      )}
    </div>
  );
}
