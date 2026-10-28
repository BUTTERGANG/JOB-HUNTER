"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface OpenStep {
  id: number;
  jobId: number;
  label: string;
  detail: string | null;
  dueDate: string | null;
  createdAt: string;
  company: string;
  role: string;
  status: string;
  url: string | null;
}

function daysFromToday(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((due.getTime() - todayUtc) / 86_400_000);
}

/**
 * The actionable queue: one next step per tracked job, ticked off as you do them.
 *
 * Deliberately not a task manager. The app decides the next step from the job's status
 * (see proposeNextStep), so this list is short by construction and never needs
 * prioritising by hand. Completing an "Apply" step also advances the job to applied —
 * that is what ticking it off means.
 */
export function NextSteps({ steps, onChanged }: { steps: OpenStep[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function act(step: OpenStep, action: "complete" | "reopen" | "delete") {
    setBusy(step.id);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${step.jobId}/steps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id, action }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Could not update that step.");
        return;
      }
      onChanged();
    } catch {
      setError("Network error — the step was not updated.");
    } finally {
      setBusy(null);
    }
  }

  const overdue = steps.filter((s) => {
    const d = daysFromToday(s.dueDate);
    return d !== null && d < 0;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-3">
          <span>Next steps</span>
          <span className="text-xs font-normal text-muted-foreground">
            {steps.length === 0
              ? "nothing pending"
              : `${steps.length} pending${overdue.length > 0 ? ` · ${overdue.length} overdue` : ""}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-xs text-destructive">{error}</p>}

        {steps.length === 0 ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Nothing to do right now — every tracked job is either waiting on someone else or closed.
            </p>
            <Link href="/jobs" className="text-xs text-primary hover:underline">
              Track a job to get a next step →
            </Link>
          </div>
        ) : (
          steps.map((step) => {
            const due = daysFromToday(step.dueDate);
            const isOverdue = due !== null && due < 0;
            return (
              <div
                key={step.id}
                className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2.5"
              >
                <Button
                  size="sm"
                  variant={isOverdue ? "default" : "outline"}
                  className="mt-0.5 shrink-0"
                  disabled={busy === step.id}
                  onClick={() => act(step, "complete")}
                >
                  {busy === step.id ? "…" : "Done"}
                </Button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{step.label}</span>
                    {step.dueDate && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${isOverdue ? "text-orange-600 border-orange-300" : ""}`}
                      >
                        {isOverdue
                          ? `${Math.abs(due!)}d overdue`
                          : due === 0
                            ? "due today"
                            : `due in ${due}d`}
                      </Badge>
                    )}
                  </div>
                  <Link
                    href={`/jobs/${step.jobId}`}
                    className="mt-0.5 block truncate text-xs text-muted-foreground hover:underline"
                  >
                    {step.company} — {step.role}
                  </Link>
                  {step.detail && (
                    <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
                  )}
                </div>

                <button
                  onClick={() => act(step, "delete")}
                  disabled={busy === step.id}
                  className="mt-1 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  title="Dismiss this step without doing it"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
