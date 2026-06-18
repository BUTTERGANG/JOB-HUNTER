"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { JOB_STATUSES, JOB_TIERS, scoreColor } from "@/lib/constants";
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
  scoreTotal: number | null;
  source: string | null;
  dateApplied: string | null;
  createdAt: string;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [loading, setLoading] = useState(true);

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
      .catch(() => setLoading(false));
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

  async function updateStatus(jobId: number, newStatus: string) {
    const updates: Record<string, string> = { status: newStatus };
    if (newStatus === "applied" && !jobs.find((j) => j.id === jobId)?.dateApplied) {
      updates.dateApplied = new Date().toISOString().split("T")[0];
    }

    await fetch(`/api/jobs/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, ...updates } : j))
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <Link href="/jobs/new">
          <Button>Add Job</Button>
        </Link>
      </div>

      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Search company, role, or location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[160px]">
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
          <SelectTrigger className="w-[140px]">
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

      <div className="text-sm text-muted-foreground mb-2">
        {filtered.length} job{filtered.length !== 1 ? "s" : ""}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Company</TableHead>
              <TableHead className="w-[200px]">Role</TableHead>
              <TableHead className="w-[120px] whitespace-nowrap">Salary</TableHead>
              <TableHead className="w-[80px] whitespace-nowrap">Score</TableHead>
              <TableHead className="w-[90px]">Tier</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[100px]">Source</TableHead>
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
                    <TableCell className="font-medium max-w-[160px]">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="hover:underline block truncate"
                      >
                        {job.company}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate">{job.role}</div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatSalary(job.salaryMin, job.salaryMax)}
                    </TableCell>
                    <TableCell>
                      {job.scoreTotal != null ? (
                        <span className={`font-mono text-sm ${scoreColor(job.scoreTotal)} ${job.scoreTotal >= 18 ? "font-bold" : ""}`}>
                          {job.scoreTotal}/25
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ti.color}>
                        {ti.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={job.status}
                        onValueChange={(v) => v && updateStatus(job.id, v)}
                      >
                        <SelectTrigger className="h-7 text-xs w-[130px]">
                          <Badge variant="outline" className={si.color}>
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
                    <TableCell>
                      <Link href={`/jobs/${job.id}`}>
                        <Button variant="ghost" size="sm">
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
    </div>
  );
}
