"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface PipelineProgress {
  total: number;
  byStatus: Record<string, number>;
  applied: number;
  responded: number;
  interviewed: number;
  offered: number;
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  medianDaysToFirstResponse: number | null;
  furthestBreakdown: { stage: string; label: string; count: number }[];
  cohorts: { week: string; applied: number; responded: number; interviewed: number; offered: number }[];
  progress: {
    jobId: number;
    company: string;
    role: string;
    furthestStage: string;
    outcome: string | null;
    daysSinceApplied: number | null;
    daysToFirstResponse: number | null;
    reachedInterview: boolean;
  }[];
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/**
 * How far the applications actually got, measured from the stage-event log.
 *
 * The distinction that matters: these counts come from how far each listing REACHED,
 * not from where it currently sits. A rejection after an onsite still counts toward the
 * onsite column, because it did get that far — reading current statuses instead would
 * make every rejection look like a rejection at the first hurdle.
 */
export function PipelineProgressCard({ data }: { data: PipelineProgress }) {
  const stages = [
    { label: "Applied", value: data.applied, rate: null as number | null },
    { label: "Responded", value: data.responded, rate: data.responseRate },
    { label: "Interview", value: data.interviewed, rate: data.interviewRate },
    { label: "Offer", value: data.offered, rate: data.offerRate },
  ];

  const hasData = data.applied > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-3">
          <span>How far you got</span>
          {data.medianDaysToFirstResponse !== null && (
            <span className="text-xs font-normal text-muted-foreground">
              median {data.medianDaysToFirstResponse}d to first response
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasData ? (
          <p className="text-sm text-muted-foreground">
            Nothing applied to yet. Once you apply, this tracks how far each one gets —
            including the ones that end in a rejection after an interview.
          </p>
        ) : (
          <>
            {/* Funnel. Rates are over APPLIED jobs, so a saved listing you never
                applied to cannot drag them down. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stages.map((stage) => (
                <div key={stage.label} className="rounded-lg border border-border/70 px-3 py-2.5">
                  <div className="text-2xl font-bold tabular-nums">{stage.value}</div>
                  <div className="text-xs text-muted-foreground">{stage.label}</div>
                  {stage.rate !== null && (
                    <div className="mt-1 text-xs font-medium text-primary">{pct(stage.rate)} of applied</div>
                  )}
                </div>
              ))}
            </div>

            {/* Furthest reached — the "how far did I make it" distribution. */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Furthest stage reached (rejections keep their high-water mark)
              </p>
              <div className="space-y-1.5">
                {data.furthestBreakdown.map((row) => {
                  const max = Math.max(1, ...data.furthestBreakdown.map((r) => r.count));
                  return (
                    <div key={row.stage} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">{row.label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${(row.count / max) * 100}%` }}
                        />
                      </span>
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums">{row.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Over time: applications grouped by the week they went out. */}
            {data.cohorts.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  By application week
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Week</th>
                        <th className="py-1 pr-3 font-medium tabular-nums">Applied</th>
                        <th className="py-1 pr-3 font-medium tabular-nums">Responded</th>
                        <th className="py-1 pr-3 font-medium tabular-nums">Interview</th>
                        <th className="py-1 font-medium tabular-nums">Offer</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {data.cohorts.map((c) => (
                        <tr key={c.week} className="border-t border-border/60">
                          <td className="py-1 pr-3">{c.week}</td>
                          <td className="py-1 pr-3">{c.applied}</td>
                          <td className="py-1 pr-3">{c.responded}</td>
                          <td className="py-1 pr-3">{c.interviewed}</td>
                          <td className="py-1">{c.offered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Per-listing detail, most progressed first. */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Per listing</p>
              <div className="space-y-1">
                {[...data.progress]
                  .filter((p) => p.daysSinceApplied !== null)
                  .sort((a, b) => b.daysSinceApplied! - a.daysSinceApplied!)
                  .slice(0, 8)
                  .map((p) => (
                    <div key={p.jobId} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">
                        {p.company} — {p.role}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {p.daysToFirstResponse !== null && (
                          <span className="text-muted-foreground">replied in {p.daysToFirstResponse}d</span>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {p.furthestStage.replace("_", " ")}
                        </Badge>
                        {p.outcome && (
                          <Badge variant="secondary" className="text-xs">
                            {p.outcome}
                          </Badge>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
