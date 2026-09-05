"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { JOB_STATUSES, JOB_TIERS, LISTING_STATUS_BADGE, scoreColor } from "@/lib/constants";
import { Spinner } from "@/components/ui/spinner";

interface Job {
  id: number;
  company: string;
  role: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: string;
  listingStatus: string | null;
  tier: string | null;
  scoreTotal: number | null;
  source: string | null;
  url: string | null;
  dateApplied: string | null;
  dateAdded: string | null;
  followUpDate: string | null;
  recruiterName: string | null;
  recruiterEmail: string | null;
  notes: string | null;
  createdAt: string;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkAllMsg, setCheckAllMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((data) => {
        setJobs(data);
        setLoading(false);
      })
      .catch(() => {
        setLoadError("Could not load your jobs. Please refresh to try again.");
        setLoading(false);
      });
  }, []);

  const filtered = jobs.filter((job) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !job.company.toLowerCase().includes(q) &&
        !job.role.toLowerCase().includes(q) &&
        !(job.location || "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (tierFilter !== "all" && job.tier !== tierFilter) return false;
    return true;
  });

  const statusInfo = (status: string) =>
    JOB_STATUSES.find((s) => s.value === status) || JOB_STATUSES[0];

  const tierInfo = (tier: string | null) =>
    JOB_TIERS.find((t) => t.value === tier) || JOB_TIERS[1];

  const formatSalary = (min: number | null, max: number | null) => {
    if (!min && !max) return "-";
    const fmt = (n: number) => `$${(n / 1000).toFixed(0)}k`;
    if (min && max) return `${fmt(min)} - ${fmt(max)}`;
    return min ? fmt(min) : fmt(max!);
  };

  // Export the currently-filtered table to a spreadsheet-friendly CSV. Salaries and
  // scores are emitted as raw numbers (not "$60k") so Google Sheets treats them as
  // numeric; Papa.unparse handles quoting for notes/commas/newlines. A UTF-8 BOM is
  // prepended so Excel also opens it cleanly.
  function exportCsv() {
    const columns: { header: string; value: (j: Job) => string | number }[] = [
      { header: "Company", value: (j) => j.company },
      { header: "Role", value: (j) => j.role },
      { header: "Location", value: (j) => j.location ?? "" },
      { header: "Salary Min", value: (j) => j.salaryMin ?? "" },
      { header: "Salary Max", value: (j) => j.salaryMax ?? "" },
      { header: "Status", value: (j) => statusInfo(j.status).label },
      { header: "Tier", value: (j) => tierInfo(j.tier).label },
      { header: "Score (/25)", value: (j) => j.scoreTotal ?? "" },
      { header: "Source", value: (j) => j.source ?? "" },
      { header: "URL", value: (j) => j.url ?? "" },
      { header: "Date Added", value: (j) => j.dateAdded ?? "" },
      { header: "Date Applied", value: (j) => j.dateApplied ?? "" },
      { header: "Follow-up Date", value: (j) => j.followUpDate ?? "" },
      { header: "Recruiter", value: (j) => j.recruiterName ?? "" },
      { header: "Recruiter Email", value: (j) => j.recruiterEmail ?? "" },
      { header: "Notes", value: (j) => j.notes ?? "" },
    ];

    const rows = filtered.map((job) => {
      const row: Record<string, string | number> = {};
      for (const col of columns) row[col.header] = col.value(job);
      return row;
    });

    const csv = Papa.unparse(rows, { columns: columns.map((c) => c.header) });
    const BOM = "﻿";
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-tracker-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function updateStatus(jobId: number, newStatus: string) {
    const updates: Record<string, string> = { status: newStatus };
    if (newStatus === "applied" && !jobs.find((j) => j.id === jobId)?.dateApplied) {
      updates.dateApplied = new Date().toISOString().split("T")[0];
    }

    setStatusError(null);
    // Only reflect the change in the UI once the server confirms it — otherwise a
    // failed PUT leaves the table showing a status that was never persisted.
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        setStatusError("Could not update job status — please try again.");
        return;
      }
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, ...updates } : j))
      );
    } catch {
      setStatusError("Network error updating job status — please try again.");
    }
  }

  async function recheckAllListings() {
    setCheckingAll(true);
    setCheckAllMsg(null);
    try {
      const res = await fetch("/api/jobs/check-listings", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCheckAllMsg(`Checked ${data.checked} — ${data.active} active, ${data.expired} expired, ${data.unknown} unknown.`);
        const refreshed = await fetch("/api/jobs");
        if (refreshed.ok) setJobs(await refreshed.json());
      } else {
        setCheckAllMsg(data.error || "Could not recheck listings.");
      }
    } catch {
      setCheckAllMsg("Network error while rechecking listings.");
    } finally {
      setCheckingAll(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/50">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Pipeline
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Jobs</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Keep your pipeline focused, current, and ready for the next move.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            variant="outline"
            onClick={recheckAllListings}
            disabled={checkingAll || jobs.length === 0}
            title="Recheck every job's listing URL for expired/closed postings"
            className="w-full sm:w-auto"
          >
            {checkingAll ? "Rechecking…" : "Recheck all listings"}
          </Button>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title={
              filtered.length === jobs.length
                ? "Download all jobs as a CSV for Google Sheets / Excel"
                : `Download the ${filtered.length} filtered job${filtered.length !== 1 ? "s" : ""} as CSV`
            }
            className="w-full sm:w-auto"
          >
            Export CSV
          </Button>
          <Link href="/jobs/new" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto">Add Job</Button>
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5" aria-label="Filter jobs">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Search & filter</h2>
            <p className="text-xs text-muted-foreground">Search and narrow your active pipeline.</p>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {filtered.length} of {jobs.length}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_9rem]">
          <Input
            placeholder="Search company, role, or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search company, role, or location"
            className="h-9 bg-background"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="h-9 w-full bg-background" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {JOB_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tierFilter} onValueChange={(v) => setTierFilter(v ?? "all")}>
            <SelectTrigger className="h-9 w-full bg-background" aria-label="Filter by tier">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              {JOB_TIERS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {loadError}
        </div>
      )}

      {checkAllMsg && (
        <div className="rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground">
          {checkAllMsg}
        </div>
      )}

      {statusError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {statusError}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm" aria-label="Job pipeline">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Pipeline</h2>
            <p className="text-xs text-muted-foreground">
              {filtered.length} job{filtered.length !== 1 ? "s" : ""} in view
            </p>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline">Select a status to update it</span>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-[160px] pl-4 text-[0.7rem] uppercase tracking-wider text-muted-foreground sm:pl-5">Company</TableHead>
                <TableHead className="w-[200px] text-[0.7rem] uppercase tracking-wider text-muted-foreground">Role</TableHead>
                <TableHead className="w-[120px] whitespace-nowrap text-[0.7rem] uppercase tracking-wider text-muted-foreground">Salary</TableHead>
                <TableHead className="w-[80px] whitespace-nowrap text-[0.7rem] uppercase tracking-wider text-muted-foreground">Score</TableHead>
                <TableHead className="w-[90px] text-[0.7rem] uppercase tracking-wider text-muted-foreground">Tier</TableHead>
                <TableHead className="w-[140px] text-[0.7rem] uppercase tracking-wider text-muted-foreground">Status</TableHead>
                <TableHead className="w-[100px] text-[0.7rem] uppercase tracking-wider text-muted-foreground">Source</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {jobs.length === 0
                    ? "No jobs yet. Add your first job or import from CSV."
                    : "No jobs match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((job) => {
                const si = statusInfo(job.status);
                const ti = tierInfo(job.tier);
                return (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-[160px] pl-4 sm:pl-5">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="block truncate font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {job.company}
                      </Link>
                      {LISTING_STATUS_BADGE[job.listingStatus ?? ""] && (
                        <Badge
                          variant="outline"
                          className={`mt-1 ${LISTING_STATUS_BADGE[job.listingStatus ?? ""]!.color} border-current/20`}
                        >
                          {LISTING_STATUS_BADGE[job.listingStatus ?? ""]!.label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate text-muted-foreground">{job.role}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-medium text-foreground">
                      {formatSalary(job.salaryMin, job.salaryMax)}
                    </TableCell>
                    <TableCell>
                      {job.scoreTotal != null ? (
                        <span className={`font-mono text-sm ${scoreColor(job.scoreTotal)} ${job.scoreTotal >= 18 ? "font-bold" : ""}`}>
                          {job.scoreTotal}/25
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${ti.color} border-current/20`}>
                        {ti.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={job.status}
                        onValueChange={(v) => v && updateStatus(job.id, v)}
                      >
                        <SelectTrigger className="h-7 w-[130px] border-transparent bg-transparent p-0 text-xs shadow-none focus-visible:ring-2">
                          <Badge variant="outline" className={`${si.color} border-current/20`}>
                            {si.label}
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
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {job.source || "-"}
                    </TableCell>
                    <TableCell className="pr-4 sm:pr-5">
                      <Link href={`/jobs/${job.id}`}>
                        <Button variant="ghost" size="sm" className="focus-visible:ring-2">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      </section>
    </div>
  );
}
