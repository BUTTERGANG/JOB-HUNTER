"use client";

import { useState, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GovJob {
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  datePosted: string | null;
  url: string | null;
  description: string | null;
}

interface GovScrapeRun {
  id: number;
  keyword: string;
  location: string;
  totalFound: number;
  createdAt: string;
}

interface GovScrapeRunDetail extends GovScrapeRun {
  results: GovJob[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso.replace(" ", "T")).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSafeUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ─── Add button ──────────────────────────────────────────────────────────────

type AddState = "idle" | "adding" | "added" | "duplicate" | "error";

function AddButton({ state, onClick }: { state: AddState; onClick: (e: React.MouseEvent) => void }) {
  if (state === "added") {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-green-600 dark:text-green-400 font-bold text-sm"
        title="Added to tracking"
      >
        ✓
      </span>
    );
  }
  if (state === "duplicate") {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-amber-600 dark:text-amber-400 font-bold text-sm"
        title="Already in tracking"
      >
        ≈
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded text-red-500 font-bold text-sm"
        title="Failed to add"
      >
        ✗
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "adding"}
      className="inline-flex items-center justify-center w-6 h-6 rounded border border-transparent hover:border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 text-base leading-none"
      title="Add to job tracking"
    >
      {state === "adding" ? (
        <span className="text-xs">…</span>
      ) : (
        <span className="font-semibold">+</span>
      )}
    </button>
  );
}

// ─── Results Table ───────────────────────────────────────────────────────────

function ResultsTable({ jobs }: { jobs: GovJob[] }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [addStates, setAddStates] = useState<Map<string, AddState>>(new Map());

  function toggleExpand(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedRow((prev) => (prev === key ? null : key));
  }

  async function addJob(i: number, e: React.MouseEvent) {
    e.stopPropagation();
    const key = `gov:${i}:${jobs[i].title}`;
    setAddStates((prev) => new Map(prev).set(key, "adding"));
    const job = jobs[i];
    try {
      const res = await fetch("/api/jobs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobs: [{
            company: job.company,
            role: job.title,
            location: job.location,
            url: job.url,
            source: "Government · Indiana",
            description: job.description,
            status: "saved",
          }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      const nextState: AddState = res.ok
        ? data.skippedDuplicates > 0
          ? "duplicate"
          : "added"
        : "error";
      setAddStates((prev) => new Map(prev).set(key, nextState));
      if (!res.ok) {
        setTimeout(() => setAddStates((prev) => { const m = new Map(prev); m.delete(key); return m; }), 3000);
      }
    } catch {
      setAddStates((prev) => new Map(prev).set(key, "error"));
      setTimeout(() => setAddStates((prev) => { const m = new Map(prev); m.delete(key); return m; }), 3000);
    }
  }

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[250px]">Title</TableHead>
            <TableHead className="w-[180px]">Location</TableHead>
            <TableHead className="w-[140px]">Salary</TableHead>
            <TableHead className="w-[120px]">Date Posted</TableHead>
            <TableHead className="w-[100px]">Source</TableHead>
            <TableHead className="w-14" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job, i) => {
            const key = `gov:${i}:${job.title}`;
            return (
              <Fragment key={key}>
                <TableRow
                  className="cursor-pointer"
                  onClick={(e) => toggleExpand(key, e)}
                >
                  <TableCell className="font-medium max-w-[250px]">
                    <div className="truncate">
                      {isSafeUrl(job.url) ? (
                        <a
                          href={job.url!}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {job.title}
                        </a>
                      ) : (
                        job.title
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[180px]">
                    <div className="truncate">{job.location || "—"}</div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {job.salary || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {job.datePosted || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      Indiana
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <AddButton
                        state={addStates.get(key) ?? "idle"}
                        onClick={(e) => addJob(i, e)}
                      />
                      {job.description && (
                        <span
                          className="text-muted-foreground text-xs select-none cursor-pointer"
                          onClick={(e) => toggleExpand(key, e)}
                        >
                          {expandedRow === key ? "▲" : "▼"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>

                {expandedRow === key && job.description && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={6} className="py-3 px-4">
                      <div className="text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {job.description}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Past Scrapes Tab ─────────────────────────────────────────────────────────

function PastScrapes() {
  const [runs, setRuns] = useState<GovScrapeRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<GovScrapeRunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/government-postings")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((data) => { setRuns(data); setLoading(false); })
      .catch(() => {
        setLoadError("Could not load past scrapes. Please refresh to try again.");
        setLoading(false);
      });
  }, []);

  async function deleteRun(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("Delete this scrape run and all its results? This cannot be undone.")) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/government-postings/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRuns((prev) => prev.filter((r) => r.id !== id));
        if (expandedId === id) { setExpandedId(null); setDetail(null); }
      } else {
        setDeleteError("Could not delete that scrape run — please try again.");
      }
    } catch {
      setDeleteError("Network error deleting scrape run — please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function loadDetail(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/government-postings/${id}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setDetail(data);
    } catch {
      setDetailError("Could not load results for this run.");
    } finally {
      setLoadingDetail(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Spinner />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-destructive text-sm">
          {loadError}
        </CardContent>
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground text-sm">
          No government job scrapes yet. Run a search above and results will appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {deleteError}
        </div>
      )}
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const searchDesc = [
          run.keyword ? `keyword: "${run.keyword}"` : "",
          run.keyword && run.location ? " · " : "",
          run.location ? `location: "${run.location}"` : "",
        ].join("") || "All listings";

        return (
          <Card key={run.id} className="overflow-hidden">
            <CardHeader
              className="cursor-pointer select-none py-4"
              onClick={() => loadDetail(run.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {searchDesc}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(run.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-bold">{run.totalFound}</div>
                    <div className="text-xs text-muted-foreground">jobs</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => deleteRun(run.id, e)}
                    disabled={deletingId === run.id}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    title="Delete scrape run"
                  >
                    {deletingId === run.id ? (
                      <span className="text-xs w-4 h-4 inline-flex items-center justify-center">…</span>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                      </svg>
                    )}
                  </button>
                  <span className="text-muted-foreground text-sm">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 border-t">
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner />
                  </div>
                ) : detailError ? (
                  <p className="text-sm text-destructive py-4 text-center">
                    {detailError}
                  </p>
                ) : detail ? (
                  detail.results.length > 0 ? (
                    <ResultsTable jobs={detail.results} />
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No results stored for this run.
                    </p>
                  )
                ) : null}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── New Search Tab ───────────────────────────────────────────────────────────

function NewSearch() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");

  const [phase, setPhase] = useState<"idle" | "scraping" | "done" | "error">("idle");
  const [jobs, setJobs] = useState<GovJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  async function runSearch() {
    setPhase("scraping");
    setError(null);
    setSaveWarning(null);
    setJobs([]);

    try {
      const res = await fetch("/api/government-postings/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), location: location.trim() }),
        signal: AbortSignal.timeout(250_000),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Scrape failed");
        setPhase("error");
        return;
      }

      setJobs(data.jobs || []);
      // Scrape succeeded but the server couldn't persist the run — surface it so
      // the user knows these results won't show up under "Past Scrapes".
      if (data.saveWarning) setSaveWarning(data.saveWarning);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request timed out or failed");
      setPhase("error");
    }
  }

  const canSearch = phase !== "scraping";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Search Indiana State Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Search for careers with the State of Indiana. Leave both fields blank to see all current listings.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Keyword (e.g. nurse, engineer, analyst)"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="Location (e.g. Indianapolis)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex-1"
            />
          </div>
          <Button onClick={runSearch} disabled={!canSearch} size="lg">
            {phase === "scraping" ? "Searching… (this may take 1–3 minutes)" : "Search Careers"}
          </Button>
        </CardContent>
      </Card>

      {phase === "scraping" && (
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <Spinner />
            <p className="text-sm text-muted-foreground">
              Scraping Indiana state job listings… This may take 1–3 minutes depending on the number of results.
            </p>
          </CardContent>
        </Card>
      )}

      {phase === "error" && error && (
        <div className="p-4 rounded-md bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">Search failed</p>
          <p className="text-xs text-red-500 mt-1">{error}</p>
        </div>
      )}

      {phase === "done" && saveWarning && (
        <div className="p-4 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800" role="alert">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Results not saved</p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{saveWarning}</p>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {jobs.length} job{jobs.length !== 1 ? "s" : ""} found
            </h2>
            {jobs.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => router.push("/jobs")}>
                View All Tracked Jobs
              </Button>
            )}
          </div>

          {jobs.length > 0 ? (
            <ResultsTable jobs={jobs} />
          ) : (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground text-sm">
                No jobs found. Try broadening your search or leave fields blank for all listings.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GovernmentPostingsPage() {
  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">Government Postings</h1>
        <Badge variant="secondary" className="text-xs">Indiana</Badge>
      </div>

      <div className="space-y-6">
        <NewSearch />
        <PastScrapes />
      </div>
    </div>
  );
}
