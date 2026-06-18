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

  function parseFile(file: File) {
    Papa.parse(file, {
      complete: (results) => {
        const data = results.data as string[][];
        if (data.length < 2) return;
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
    if (file?.name.endsWith(".csv")) parseFile(file);
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
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Import from CSV</h1>

      {!headers.length && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            <div className="text-center">
              <p className="font-medium">Drop a CSV here, or click to choose</p>
              <p className="text-sm text-muted-foreground mt-1">Columns are auto-detected and mapped</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="hidden"
            />
          </div>

          <Card>
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
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
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
                <p className="text-sm text-red-600 mt-4">
                  You must map at least "Company" and "Role" columns.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview ({rows.length} rows)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
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

          <div className="flex gap-3">
            <Button onClick={handleImport} disabled={!canImport || importing}>
              {importing ? "Importing..." : `Import ${rows.length} Jobs`}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setHeaders([]);
                setRows([]);
                setMapping([]);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="text-4xl font-bold text-green-600">{result.created}</div>
              <p className="text-muted-foreground">jobs imported successfully</p>
              {result.errors.length > 0 && (
                <div className="text-left mt-4">
                  <p className="text-sm text-red-600 font-medium">{result.errors.length} errors:</p>
                  <ul className="text-xs text-red-500 mt-2 space-y-1">
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
