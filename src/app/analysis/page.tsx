"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getSectorColor } from "@/lib/socSectors";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarketData {
  totalRaw: number;
  totalUnique: number;
  duplicatesRemoved: number;
  avgScore: number | null;
  avgSalary: number | null;
  remotePct: number;
  sectorBreakdown: { name: string; count: number; pct: number }[];
  jobTypeBreakdown: { name: string; count: number; pct: number }[];
  degreeBreakdown: { name: string; count: number; pct: number }[];
  locationBreakdown: { name: string; count: number; pct: number }[];
  remoteVsOnsite: { remote: number; onsite: number };
  salaryDistribution: { range: string; count: number }[];
  scoreDistribution: { range: string; count: number }[];
  topCompanies: { name: string; count: number }[];
  experienceBreakdown: { name: string; count: number; pct: number }[];
  sourceBreakdown: { name: string; count: number; pct: number }[];
  postingsTimeline: { week: string; count: number }[];
  topBenefits: { name: string; count: number; pct: number }[];
}

// ─── Color palette ────────────────────────────────────────────────────────────

const PIE_COLORS = [
  "#6366f1", "#06b6d4", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#ec4899", "#14b8a6", "#8b5cf6", "#84cc16",
  "#f59e0b", "#3b82f6", "#d946ef", "#78716c", "#64748b",
];

const SCORE_COLORS: Record<string, string> = {
  "0–20": "#ef4444",
  "21–40": "#f97316",
  "41–60": "#eab308",
  "61–80": "#22c55e",
  "81–100": "#10b981",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtSalary(n: number | null) {
  if (n == null) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { pct: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium">{d.name}</p>
      <p className="text-muted-foreground">{fmt(d.value)} jobs ({d.payload.pct}%)</p>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Legend component ─────────────────────────────────────────────────────────

function ChartLegend({ items }: { items: { name: string; color: string; count: number }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-1.5 text-xs">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
          <span className="text-muted-foreground">{item.name}</span>
          <span className="font-medium">({item.count})</span>
        </div>
      ))}
    </div>
  );
}

// ─── Chart Table (collapsible data table under each chart) ────────────────────

interface ChartTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: (val: unknown) => string;
}

function ChartTable({ columns, data, title }: { columns: ChartTableColumn[]; data: Record<string, unknown>[]; title?: string }) {
  const [open, setOpen] = useState(false);
  if (data.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <span className={`transition-transform inline-block ${open ? "rotate-90" : ""}`}>▶</span>
        {title ?? "Show data table"} ({data.length} rows)
      </button>
      {open && (
        <div className="mt-2 border rounded-md overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-1.5 font-medium text-muted-foreground ${col.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                  {columns.map((col) => {
                    const val = row[col.key];
                    const display = col.format ? col.format(val) : String(val ?? "—");
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-1 ${col.align === "right" ? "text-right font-mono" : ""}`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [minScoreFilter, setMinScoreFilter] = useState("0");
  const [sources, setSources] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (minScoreFilter !== "0") params.set("minScore", minScoreFilter);
      const res = await fetch(`/api/analysis/market?${params}`);
      if (!res.ok) throw new Error("Failed to load market data");
      const json: MarketData = await res.json();
      setData(json);
      // Extract unique sources from breakdown
      const srcs = json.sourceBreakdown.map((s) => s.name).sort();
      setSources(srcs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [sourceFilter, minScoreFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold mb-6">Market Analysis</h1>
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold mb-6">Market Analysis</h1>
        <div className="p-4 rounded-md bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">{error ?? "No data available"}</p>
          <p className="text-xs text-red-500 mt-1">Run some scrapes first to see market analysis.</p>
        </div>
      </div>
    );
  }

  const remotePie = [
    { name: "Remote", value: data.remoteVsOnsite.remote },
    { name: "On-site", value: data.remoteVsOnsite.onsite },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Market Analysis</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Job market breakdown across all scraped data, deduplicated by listing URL.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={sourceFilter} onValueChange={(v) => v && setSourceFilter(v)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minScoreFilter} onValueChange={(v) => v && setMinScoreFilter(v)}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="All scores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">All scores</SelectItem>
              <SelectItem value="40">40+</SelectItem>
              <SelectItem value="60">60+</SelectItem>
              <SelectItem value="80">80+</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dedup banner */}
      {data.duplicatesRemoved > 0 && (
        <div className="mb-4 p-3 rounded-md bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <strong>{fmt(data.duplicatesRemoved)}</strong> duplicate listings removed.
          Showing <strong>{fmt(data.totalUnique)}</strong> unique jobs from <strong>{fmt(data.totalRaw)}</strong> total scraped.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Unique Jobs" value={fmt(data.totalUnique)} sub={data.duplicatesRemoved > 0 ? `${fmt(data.totalRaw)} raw scraped` : undefined} />
        <StatCard label="Avg Score" value={data.avgScore ?? "—"} sub="out of 100" />
        <StatCard label="Avg Salary (est.)" value={fmtSalary(data.avgSalary)} sub="estimated minimum" />
        <StatCard label="Remote" value={`${data.remotePct}%`} sub={`${fmt(data.remoteVsOnsite.remote)} of ${fmt(data.totalUnique)}`} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="salary">Salary</TabsTrigger>
          <TabsTrigger value="demand">Demand</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* ─── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Sectors pie */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Job Sectors (SOC)</CardTitle></CardHeader>
              <CardContent>
                {data.sectorBreakdown.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={data.sectorBreakdown}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={100}
                          dataKey="count"
                          nameKey="name"
                          stroke="none"
                        >
                          {data.sectorBreakdown.map((entry) => (
                            <Cell key={entry.name} fill={getSectorColor(entry.name)} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ChartLegend items={data.sectorBreakdown.slice(0, 8).map((e) => ({ name: e.name, color: getSectorColor(e.name), count: e.count }))} />
                    <ChartTable
                      columns={[
                        { key: "name", label: "Sector" },
                        { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                        { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                      ]}
                      data={data.sectorBreakdown}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No SOC code data yet. Sectors appear after AI analysis.</p>
                )}
              </CardContent>
            </Card>

            {/* Job types pie */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Job Types</CardTitle></CardHeader>
              <CardContent>
                {data.jobTypeBreakdown.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={data.jobTypeBreakdown}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={100}
                          dataKey="count"
                          nameKey="name"
                          stroke="none"
                        >
                          {data.jobTypeBreakdown.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ChartLegend items={data.jobTypeBreakdown.slice(0, 8).map((e, i) => ({ name: e.name, color: PIE_COLORS[i % PIE_COLORS.length], count: e.count }))} />
                    <ChartTable
                      columns={[
                        { key: "name", label: "Job Type" },
                        { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                        { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                      ]}
                      data={data.jobTypeBreakdown}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No job type data available.</p>
                )}
              </CardContent>
            </Card>

            {/* Degree requirements pie */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Degree Requirements</CardTitle></CardHeader>
              <CardContent>
                {data.degreeBreakdown.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={data.degreeBreakdown}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={100}
                          dataKey="count"
                          nameKey="name"
                          stroke="none"
                        >
                          {data.degreeBreakdown.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ChartLegend items={data.degreeBreakdown.map((e, i) => ({ name: e.name, color: PIE_COLORS[i % PIE_COLORS.length], count: e.count }))} />
                    <ChartTable
                      columns={[
                        { key: "name", label: "Degree" },
                        { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                        { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                      ]}
                      data={data.degreeBreakdown}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No degree requirement data yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Remote vs Onsite pie */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Remote vs On-site</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={remotePie}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={100}
                      dataKey="value"
                      nameKey="name"
                      stroke="none"
                    >
                      <Cell fill="#22c55e" />
                      <Cell fill="#6366f1" />
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <ChartLegend items={[
                  { name: "Remote", color: "#22c55e", count: data.remoteVsOnsite.remote },
                  { name: "On-site", color: "#6366f1", count: data.remoteVsOnsite.onsite },
                ]} />
                <ChartTable
                  columns={[
                    { key: "name", label: "Type" },
                    { key: "value", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                  ]}
                  data={remotePie}
                />
              </CardContent>
            </Card>
          </div>

          {/* Location breakdown */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Location Areas</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {data.locationBreakdown.map((loc) => (
                  <Badge key={loc.name} variant="outline" className="text-xs px-3 py-1">
                    {loc.name}: <span className="font-bold ml-1">{loc.count}</span>
                    <span className="text-muted-foreground ml-1">({loc.pct}%)</span>
                  </Badge>
                ))}
              </div>
              <ChartTable
                columns={[
                  { key: "name", label: "Location" },
                  { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                  { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                ]}
                data={data.locationBreakdown}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── SALARY TAB ───────────────────────────────────────────────────── */}
        <TabsContent value="salary" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Salary distribution bar */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Salary Distribution (Estimated Min)</CardTitle></CardHeader>
              <CardContent>
                {data.salaryDistribution.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={data.salaryDistribution}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
                          formatter={(value) => [fmt(Number(value)), "Jobs"]}
                        />
                        <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <ChartTable
                      columns={[
                        { key: "range", label: "Salary Range" },
                        { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                      ]}
                      data={data.salaryDistribution}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No salary estimate data yet. Appears after AI analysis.</p>
                )}
              </CardContent>
            </Card>

            {/* Score distribution bar */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Score Distribution</CardTitle></CardHeader>
              <CardContent>
                {data.scoreDistribution.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={data.scoreDistribution}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
                          formatter={(value) => [fmt(Number(value)), "Jobs"]}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {data.scoreDistribution.map((entry) => (
                            <Cell key={entry.range} fill={SCORE_COLORS[entry.range] ?? "#94a3b8"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <ChartTable
                      columns={[
                        { key: "range", label: "Score Range" },
                        { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                      ]}
                      data={data.scoreDistribution}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No score data yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top benefits */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Most Common Benefits</CardTitle></CardHeader>
            <CardContent>
              {data.topBenefits.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {data.topBenefits.map((b) => (
                      <Badge key={b.name} variant="secondary" className="text-xs px-3 py-1">
                        {b.name}
                        <span className="font-bold ml-1.5">{b.pct}%</span>
                      </Badge>
                    ))}
                  </div>
                  <ChartTable
                    columns={[
                      { key: "name", label: "Benefit" },
                      { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                      { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                    ]}
                    data={data.topBenefits}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No benefit data yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── DEMAND TAB ───────────────────────────────────────────────────── */}
        <TabsContent value="demand" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top companies */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Top Companies Hiring</CardTitle></CardHeader>
              <CardContent>
                {data.topCompanies.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={data.topCompanies.slice(0, 12)} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
                          formatter={(value) => [fmt(Number(value)), "Listings"]}
                        />
                        <Bar dataKey="count" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <ChartTable
                      columns={[
                        { key: "name", label: "Company" },
                        { key: "count", label: "Listings", align: "right", format: (v) => fmt(Number(v)) },
                      ]}
                      data={data.topCompanies.slice(0, 12)}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No company data yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Experience breakdown */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Experience Requirements</CardTitle></CardHeader>
              <CardContent>
                {data.experienceBreakdown.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={data.experienceBreakdown}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={100}
                          dataKey="count"
                          nameKey="name"
                          stroke="none"
                        >
                          {data.experienceBreakdown.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ChartLegend items={data.experienceBreakdown.map((e, i) => ({ name: e.name, color: PIE_COLORS[i % PIE_COLORS.length], count: e.count }))} />
                    <ChartTable
                      columns={[
                        { key: "name", label: "Experience" },
                        { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                        { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                      ]}
                      data={data.experienceBreakdown}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">No experience data yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Source breakdown */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Listings by Source</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {data.sourceBreakdown.map((s) => (
                  <Badge key={s.name} variant="outline" className="text-xs px-3 py-1 capitalize">
                    {s.name}: <span className="font-bold ml-1">{s.count}</span>
                    <span className="text-muted-foreground ml-1">({s.pct}%)</span>
                  </Badge>
                ))}
              </div>
              <ChartTable
                columns={[
                  { key: "name", label: "Source" },
                  { key: "count", label: "Jobs", align: "right", format: (v) => fmt(Number(v)) },
                  { key: "pct", label: "%", align: "right", format: (v) => `${v}%` },
                ]}
                data={data.sourceBreakdown}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TIMELINE TAB ────────────────────────────────────────────────── */}
        <TabsContent value="timeline" className="space-y-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Job Postings Over Time</CardTitle></CardHeader>
            <CardContent>
              {data.postingsTimeline.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={data.postingsTimeline}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="week"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => {
                          const d = new Date(String(v));
                          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
                        labelFormatter={(v) => {
                          const d = new Date(String(v));
                          return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                        }}
                        formatter={(value) => [fmt(Number(value)), "Postings"]}
                      />
                      <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <ChartTable
                    title="Show weekly breakdown"
                    columns={[
                      { key: "week", label: "Week", format: (v) => {
                        const d = new Date(String(v));
                        return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                      }},
                      { key: "count", label: "Postings", align: "right", format: (v) => fmt(Number(v)) },
                    ]}
                    data={data.postingsTimeline}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">No timeline data yet. Postings appear as scrapes collect date information.</p>
              )}
            </CardContent>
          </Card>

          {/* Cumulative */}
          {data.postingsTimeline.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Cumulative Unique Listings</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={data.postingsTimeline.reduce<{ week: string; cumulative: number }[]>((acc, cur) => {
                      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
                      acc.push({ week: cur.week, cumulative: prev + cur.count });
                      return acc;
                    }, [])}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => {
                        const d = new Date(String(v));
                        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
                      labelFormatter={(v) => {
                        const d = new Date(String(v));
                        return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                      }}
                      formatter={(value) => [fmt(Number(value)), "Total"]}
                    />
                    <Line type="monotone" dataKey="cumulative" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
