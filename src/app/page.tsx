"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { JOB_STATUSES, FOLLOW_UP_DAYS, TERMINAL_STATUSES } from "@/lib/constants";
import { Spinner } from "@/components/ui/spinner";

interface Job {
  id: number;
  company: string;
  role: string;
  status: string;
  tier: string | null;
  scoreTotal: number | null;
  dateApplied: string | null;
  createdAt: string;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load jobs");
        return r.json();
      })
      .then((data) => {
        setJobs(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  const statusCounts: Record<string, number> = {};
  const activeJobs = jobs.filter((j) => !(TERMINAL_STATUSES as readonly string[]).includes(j.status));
  let totalApplied = 0;
  let totalScreens = 0;
  let totalTechnicals = 0;
  let totalOnsites = 0;
  let totalOffers = 0;
  const needFollowUp: Job[] = [];
  const now = new Date();

  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    if (job.status !== "saved") totalApplied++;
    if (["phone_screen", "technical", "onsite", "offer"].includes(job.status)) totalScreens++;
    if (["technical", "onsite", "offer"].includes(job.status)) totalTechnicals++;
    if (["onsite", "offer"].includes(job.status)) totalOnsites++;
    if (job.status === "offer") totalOffers++;

    if (job.status === "applied" && job.dateApplied) {
      const applied = new Date(job.dateApplied);
      const daysSince = Math.floor((now.getTime() - applied.getTime()) / 86400000);
      if (daysSince >= FOLLOW_UP_DAYS) needFollowUp.push(job);
    }
  }

  const rates = {
    appToScreen: totalApplied > 0 ? Math.round((totalScreens / totalApplied) * 100) : 0,
    screenToTechnical: totalScreens > 0 ? Math.round((totalTechnicals / totalScreens) * 100) : 0,
    technicalToOnsite: totalTechnicals > 0 ? Math.round((totalOnsites / totalTechnicals) * 100) : 0,
    onsiteToOffer: totalOnsites > 0 ? Math.round((totalOffers / totalOnsites) * 100) : 0,
  };

  const activeInterviews =
    (statusCounts["phone_screen"] || 0) +
    (statusCounts["technical"] || 0) +
    (statusCounts["onsite"] || 0);

  const conversionMetrics = [
    { label: "App -> Screen", value: rates.appToScreen, target: 8 },
    { label: "Screen -> Technical", value: rates.screenToTechnical, target: 50 },
    { label: "Technical -> Onsite", value: rates.technicalToOnsite, target: 40 },
    { label: "Onsite -> Offer", value: rates.onsiteToOffer, target: 25 },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/jobs/new">
            <Button>Add Job</Button>
          </Link>
          <Link href="/import">
            <Button variant="outline">Import CSV</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="text-3xl font-bold">{jobs.length}</div>
            <div className="text-sm text-muted-foreground">Total Jobs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-3xl font-bold">{totalApplied}</div>
            <div className="text-sm text-muted-foreground">Applied</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className={`text-3xl font-bold ${activeInterviews >= 3 ? "text-orange-600" : ""}`}>
              {activeInterviews}
            </div>
            <div className="text-sm text-muted-foreground">
              Active Interviews
              {activeInterviews >= 5 && (
                <span className="text-orange-600 font-medium block">Pause new apps!</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className={`text-3xl font-bold ${totalOffers > 0 ? "text-green-600" : ""}`}>{totalOffers}</div>
            <div className="text-sm text-muted-foreground">Offers</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Conversion Rates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {totalApplied === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Start applying to see conversion metrics.
                </p>
                <Link href="/jobs/new">
                  <Button size="sm" variant="outline">Add your first job</Button>
                </Link>
              </div>
            ) : (
              conversionMetrics.map((m) => (
                <div key={m.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{m.label}</span>
                    <span
                      className={`text-sm font-mono font-bold ${
                        m.value >= m.target
                          ? "text-green-600"
                          : m.value > 0
                          ? "text-yellow-600"
                          : "text-muted-foreground"
                      }`}
                    >
                      {m.value}%
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        (target: {m.target}%)
                      </span>
                    </span>
                  </div>
                  <Progress value={Math.min(m.value, 100)} className="h-2" />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {JOB_STATUSES.map((s) => {
                const count = statusCounts[s.value] || 0;
                if (count === 0) return null;
                return (
                  <div key={s.value} className="flex items-center justify-between">
                    <Badge variant="outline" className={s.color}>
                      {s.label}
                    </Badge>
                    <span className="font-mono text-sm">{count}</span>
                  </div>
                );
              })}
              {jobs.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">No jobs tracked yet.</p>
                  <div className="flex gap-2 flex-wrap">
                    <Link href="/jobs/new">
                      <Button size="sm" variant="outline">Add a job</Button>
                    </Link>
                    <Link href="/scrape">
                      <Button size="sm" variant="ghost">Scrape listings</Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {needFollowUp.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-orange-700">Needs Follow-Up</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {needFollowUp.map((job) => {
                const days = Math.floor(
                  (now.getTime() - new Date(job.dateApplied!).getTime()) / 86400000
                );
                return (
                  <div key={job.id} className="flex items-center justify-between">
                    <Link href={`/jobs/${job.id}`} className="hover:underline text-sm">
                      {job.company} — {job.role}
                    </Link>
                    <span className="text-xs text-orange-600">{days} days ago</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {jobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Jobs</span>
              <Link href="/jobs">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {jobs.slice(0, 5).map((job) => {
                const si = JOB_STATUSES.find((s) => s.value === job.status) || JOB_STATUSES[0];
                return (
                  <div key={job.id} className="flex items-center justify-between py-1">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="hover:underline text-sm font-medium"
                    >
                      {job.company} — {job.role}
                    </Link>
                    <div className="flex items-center gap-2">
                      {job.scoreTotal != null && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {job.scoreTotal}/25
                        </span>
                      )}
                      <Badge variant="outline" className={si.color}>
                        {si.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
