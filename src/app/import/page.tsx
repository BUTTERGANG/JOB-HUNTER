"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const JOB_FIELDS = [
  { value: "skip", label: "Skip" },
  { value: "company", label: "Company" },
  { value: "role", label: "Role" },
  { value: "location", label: "Location" },
  { value: "salaryMin", label: "Salary Min" },
  { value: "salaryMax", label: "Salary Max" },
  { value: "url", label: "URL" },
  { value: "source", label: "Source" },
  { value: "status", label: "Status" },
  { value: "notes", label: "Notes" },
  { value: "description", label: "Description" },
];

function guessMapping(header: string): string {
  const h = header.toLowerCase().trim();
  if (h.includes("company")) return "company";
  if (h.includes("role") || h.includes("title") || h.includes("position")) return "role";
  if (h.includes("location") || h.includes("city")) return "location";
  if (h.includes("salary") && h.includes("min")) return "salaryMin";
  if (h.includes("salary") && (h.includes("max") || h.includes("range"))) return "salaryMax";
  if (h.includes("url") || h.includes("link")) return "url";
  if (h.includes("source") || h.includes("found") || h.includes("board")) return "source";
  if (h.includes("status")) return "status";
  if (h.includes("note")) return "notes";
  if (h.includes("description") || h.includes("jd")) return "description";
  return "skip";
}

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  function parseFile(file: File) {
    setParseError(null);
    Papa.parse(file, {
      error: (err) => {
        setParseError(`Could not read that CSV: ${err.message}`);
      },
      complete: (results) => {
        const data = (results.data as string[][]).filter((r) => r.some((c) => c?.trim()));
        if (data.length < 2) {
          setParseError(
            "That file doesn't look like a valid CSV — it needs a header row and at least one data row."
          );
          return;
        }
        const hdrs = data[0];
        setHeaders(hdrs);
        setRows(data.slice(1).filter((r) => r.some((c) => c.trim())));
        setMapping(hdrs.map(guessMapping));
      },
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.name.endsWith(".csv")) {
      parseFile(file);
    } else {
      setParseError("Please drop a .csv file.");
    }
  }

  function updateMapping(index: number, value: string) {
    setMapping((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    setResult(null);

    const jobs = rows.map((row) => {
      const job: Record<string, string> = {};
      mapping.forEach((field, i) => {
        if (field !== "skip" && row[i]?.trim()) {
          job[field] = row[i].trim();
        }
      });
      return job;
    });

    const validJobs = jobs.filter((j) => j.company && j.role);

    try {
      const res = await fetch("/api/jobs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: validJobs }),
      });

      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ created: 0, errors: ["Network error during import"] });
    }
    setImporting(false);
  }

  const hasCompany = mapping.includes("company");
  const hasRole = mapping.includes("role");
  const canImport = hasCompany && hasRole && rows.length > 0;

  return (
    <div className="max-w-5xl space-y-6">
      <header className="border-b border-border/70 pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Pipeline intake
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Import from CSV</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Bring an existing job list into your signal board, then review the mapping before it lands.
        </p>
      </header>

      {!headers.length && (
        <div className="space-y-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed p-8 transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-12 ${
              dragOver
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border/80 bg-card hover:border-primary/50 hover:bg-accent/30"
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
            }}
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground">Drop a CSV here, or click to choose</p>
              <p className="mt-1 text-sm text-muted-foreground">Columns are auto-detected and mapped</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="hidden"
            />
          </div>

          {parseError && (
            <p className="text-sm text-destructive" role="alert">
              {parseError}
            </p>
          )}

          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Expected columns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-1 text-xs">
                {[
                  ["Company", "required"],
                  ["Role / Title", "required"],
                  ["Location", ""],
                  ["Job URL / Link", ""],
                  ["Source", ""],
                  ["Description / JD", ""],
                  ["Salary Min", ""],
                  ["Salary Max", ""],
                  ["Status", ""],
                  ["Notes", ""],
                ].map(([col, note]) => (
                  <div key={col} className="flex items-center gap-1.5 py-0.5">
                    <span className="font-mono text-foreground">{col}</span>
                    {note && <span className="text-red-500 text-xs">*</span>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                JobSpy CSVs from the Scrape page import automatically with no mapping needed.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {headers.length > 0 && !result && (
        <div className="space-y-6">
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/60 bg-muted/20">
              <CardTitle>Map Columns</CardTitle>
              <p className="text-sm text-muted-foreground">Confirm how each source column should be stored.</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {headers.map((header, i) => (
                  <div key={i}>
                    <label className="text-xs text-muted-foreground block mb-1 truncate">
                      {header}
                    </label>
                    <Select
                      value={mapping[i]}
                      onValueChange={(v) => updateMapping(i, v ?? "skip")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_FIELDS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {(!hasCompany || !hasRole) && (
                <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                  You must map at least &quot;Company&quot; and &quot;Role&quot; columns.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/60 bg-muted/20">
              <CardTitle>Preview ({rows.length} rows)</CardTitle>
              <p className="text-sm text-muted-foreground">Review the first rows before importing the full file.</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border/70">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      {headers.map((h, i) => (
                        <TableHead key={i} className="text-xs">
                          {mapping[i] !== "skip" ? mapping[i] : <span className="text-muted-foreground line-through">{h}</span>}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((row, ri) => (
                      <TableRow key={ri}>
                        {row.map((cell, ci) => (
                          <TableCell
                            key={ci}
                            className={`text-xs ${mapping[ci] === "skip" ? "text-muted-foreground" : ""}`}
                          >
                            {cell.slice(0, 50)}{cell.length > 50 ? "..." : ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 5 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing 5 of {rows.length} rows
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row">
            <Button onClick={handleImport} disabled={!canImport || importing} className="w-full sm:w-auto">
              {importing ? "Importing..." : `Import ${rows.length} Jobs`}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setHeaders([]);
                setRows([]);
                setMapping([]);
              }}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="pt-6">
            <div className="space-y-4 text-center">
              <div className="text-4xl font-bold text-green-600">{result.created}</div>
              <p className="text-muted-foreground">jobs imported successfully</p>
              {result.errors.length > 0 && (
                <div className="text-left mt-4">
                  <p className="font-medium text-sm text-destructive">{result.errors.length} errors:</p>
                  <ul className="mt-2 space-y-1 text-xs text-destructive/80">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button onClick={() => router.push("/jobs")}>View Jobs</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
