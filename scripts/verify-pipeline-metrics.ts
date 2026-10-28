/**
 * Offline verification of the pipeline-progress logic — no DB, no network, no API key.
 *
 *   node_modules/.bin/tsx scripts/verify-pipeline-metrics.ts
 *
 * The rules being asserted are the ones that are easy to get quietly wrong:
 *  - "how far did I get" must survive a rejection (a rejection after an onsite is not
 *    the same as a rejection the day after applying)
 *  - conversion rates must be computed over APPLIED jobs, not over everything tracked
 *  - timestamps come from SQLite as UTC, and parsing them as local time shifts day
 *    counts
 */

import {
  PIPELINE_STAGES,
  computeJobProgress,
  computePipelineMetrics,
  daysBetween,
  furthestReached,
  isoWeek,
  parseTs,
  proposeNextStep,
  stageOrdinal,
} from "../src/lib/pipeline";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = "") {
  checks++;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  // Object.is is reference equality for arrays/objects, so a correct result like [3,5]
  // would fail against an equal-but-distinct [3,5]. Compare structurally for those.
  const same =
    typeof actual === "object" && actual !== null
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : Object.is(actual, expected);
  check(name, same, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = new Date("2026-10-28T12:00:00Z");

// ── stage ordering ──────────────────────────────────────────────────────────
eq("saved is ordinal 0", stageOrdinal("saved"), 0);
eq("applied is ordinal 1", stageOrdinal("applied"), 1);
eq("offer is the highest stage", stageOrdinal("offer"), PIPELINE_STAGES.length - 1);
eq("rejected has no ordinal", stageOrdinal("rejected"), null);
eq("unknown status has no ordinal", stageOrdinal("nonsense"), null);
eq("null has no ordinal", stageOrdinal(null), null);

// ── the case that motivates the whole event log ─────────────────────────────
{
  const path = ["saved", "applied", "phone_screen", "technical", "onsite", "rejected"];
  const { stage, ordinal } = furthestReached(path);
  eq("rejection after an onsite still counts as reaching onsite", stage, "onsite");
  eq("…with the onsite ordinal", ordinal, 4);

  const early = furthestReached(["saved", "applied", "rejected"]);
  eq("rejection after applying only counts as applied", early.stage, "applied");
  check(
    "the two rejections are distinguishable",
    ordinal > early.ordinal,
    "both paths end in 'rejected' — without the event log they would be identical"
  );
}

// ── timestamps are UTC ──────────────────────────────────────────────────────
{
  // SQLite's datetime('now') form. Parsed as local time this would land on the wrong
  // day for anyone west of UTC.
  const parsed = parseTs("2026-10-27 23:30:00");
  eq("SQLite datetime parses as UTC", parsed?.toISOString(), "2026-10-27T23:30:00.000Z");
  eq("plain date parses at UTC midnight", parseTs("2026-10-27")?.toISOString(), "2026-10-27T00:00:00.000Z");
  eq("empty string is null", parseTs(""), null);
  eq("garbage is null", parseTs("not a date"), null);

  eq(
    "daysBetween counts whole days",
    daysBetween(parseTs("2026-10-20"), parseTs("2026-10-27")),
    7
  );
}

// ── next steps ──────────────────────────────────────────────────────────────
{
  eq("saved → Apply", proposeNextStep({ status: "saved" }, NOW)?.label, "Apply");
  eq("offer → respond", proposeNextStep({ status: "offer" }, NOW)?.label, "Respond to the offer");
  eq("rejected → nothing to do", proposeNextStep({ status: "rejected" }, NOW), null);
  eq("ghosted → nothing to do", proposeNextStep({ status: "ghosted" }, NOW), null);
  eq("withdrew → nothing to do", proposeNextStep({ status: "withdrew" }, NOW), null);

  // Applied 3 days ago: not yet due, so the step says when, not "follow up now".
  // Applied 2026-10-25, window is FOLLOW_UP_DAYS (10) → due 2026-11-04, which is 7 days
  // from NOW (2026-10-28). Asserting the NUMBER, because measuring from a timestamp
  // instead of from today silently reported this as "in 6 days".
  const fresh = proposeNextStep({ status: "applied", dateApplied: "2026-10-25" }, NOW);
  eq("a pending follow-up counts whole days from today", fresh?.label, "Follow up in 7 days");
  eq("…and is due on the 10-day mark", fresh?.dueDate, "2026-11-04");

  // Applied 20 days ago with no recorded follow-up: overdue.
  const stale = proposeNextStep({ status: "applied", dateApplied: "2026-10-08" }, NOW);
  eq("an overdue application becomes a follow-up", stale?.label, "Follow up");
  check(
    "the overdue follow-up is due today, not in the past",
    (stale?.dueDate ?? "") <= "2026-10-28",
    `dueDate: ${stale?.dueDate}`
  );
}

// ── per-job progress ────────────────────────────────────────────────────────
{
  const job = { id: 1, company: "Danbren Media", role: "Wedding Videographer", status: "technical", dateApplied: "2026-10-10" };
  const events = [
    { jobId: 1, fromStatus: "saved", toStatus: "applied", occurredAt: "2026-10-10 09:00:00" },
    { jobId: 1, fromStatus: "applied", toStatus: "phone_screen", occurredAt: "2026-10-15 09:00:00" },
    { jobId: 1, fromStatus: "phone_screen", toStatus: "technical", occurredAt: "2026-10-22 09:00:00" },
  ];
  const p = computeJobProgress(job, events, NOW);
  eq("furthest stage is technical", p.furthestStage, "technical");
  eq("days since applied", p.daysSinceApplied, 18);
  eq("days to first response", p.daysToFirstResponse, 5);
  eq("reached a response", p.reachedResponse, true);
  eq("reached an interview", p.reachedInterview, true);
  eq("no offer", p.reachedOffer, false);
  eq("days in current status (from 2026-10-22)", p.daysInCurrentStatus, 6);

  // An imported job with a date_applied but no events must still count as applied.
  const imported = computeJobProgress(
    { id: 2, company: "Firebelly", role: "Photographer", status: "applied", dateApplied: "2026-10-01" },
    [],
    NOW
  );
  eq("imported job counts as applied", imported.furthestOrdinal, 1);
  eq("imported job has no response time yet", imported.daysToFirstResponse, null);
  eq("imported job days since applied", imported.daysSinceApplied, 27);
}

// ── aggregate metrics ───────────────────────────────────────────────────────
{
  const jobs = [
    // Applied, no response (week 1)
    { id: 1, company: "A", role: "r", status: "applied", dateApplied: "2026-10-05" },
    // Applied → phone screen (week 1)
    { id: 2, company: "B", role: "r", status: "phone_screen", dateApplied: "2026-10-06" },
    // Applied → onsite (week 2)
    { id: 3, company: "C", role: "r", status: "onsite", dateApplied: "2026-10-13" },
    // Applied → offer (week 2)
    { id: 4, company: "D", role: "r", status: "offer", dateApplied: "2026-10-14" },
    // Rejected after an onsite — the "how far did I get" case (week 3)
    { id: 5, company: "E", role: "r", status: "rejected", dateApplied: "2026-10-20" },
    // Saved, never applied — must NOT dilute the rates
    { id: 6, company: "F", role: "r", status: "saved", dateApplied: null },
  ];
  const events = [
    { jobId: 2, fromStatus: "applied", toStatus: "phone_screen", occurredAt: "2026-10-09 10:00:00" },
    { jobId: 3, fromStatus: "applied", toStatus: "onsite", occurredAt: "2026-10-19 10:00:00" },
    { jobId: 4, fromStatus: "applied", toStatus: "offer", occurredAt: "2026-10-20 10:00:00" },
    { jobId: 5, fromStatus: "saved", toStatus: "applied", occurredAt: "2026-10-20 10:00:00" },
    { jobId: 5, fromStatus: "applied", toStatus: "onsite", occurredAt: "2026-10-24 10:00:00" },
    { jobId: 5, fromStatus: "onsite", toStatus: "rejected", occurredAt: "2026-10-27 10:00:00" },
  ];

  const m = computePipelineMetrics(jobs, events, NOW);
  eq("total tracked", m.total, 6);
  eq("applied excludes the saved job", m.applied, 5);
  eq("responded = 4 (all but job 1)", m.responded, 4);
  eq("interviewed = 3 (technical/onsite/offer)", m.interviewed, 3);
  eq("offered = 1", m.offered, 1);
  eq("response rate over applied", m.responseRate, 80);
  eq("interview rate over applied", m.interviewRate, 60);
  eq("offer rate over applied", m.offerRate, 20);
  eq("median days to first response", m.medianDaysToFirstResponse, 5);

  // Two listings reached an onsite: job 3 (still live) and job 5 (rejected afterwards).
  // The point of the breakdown is that BOTH are credited with getting that far.
  const onsite = m.furthestBreakdown.find((f) => f.stage === "onsite");
  eq("both listings that reached an onsite are counted there", onsite?.count, 2);
  eq(
    "…including the one that was later rejected",
    m.progress.filter((p) => p.furthestStage === "onsite").map((p) => p.jobId).sort(),
    [3, 5]
  );
  const appliedOnly = m.furthestBreakdown.find((f) => f.stage === "applied");
  eq("job 1 sits at applied", appliedOnly?.count, 1);
  eq(
    "the saved job is absent from the furthest breakdown",
    m.furthestBreakdown.reduce((sum, f) => sum + f.count, 0),
    5
  );

  // Rejected job 5 must still be visible as having reached an onsite.
  const p5 = m.progress.find((p) => p.jobId === 5)!;
  eq("a rejected listing keeps its furthest stage", p5.furthestStage, "onsite");
  eq("…and records the outcome separately", p5.outcome, "rejected");

  eq("cohorts cover three application weeks", m.cohorts.length, 3);
  eq("week 1 applied", m.cohorts[0].applied, 2);
  eq("week 1 responded", m.cohorts[0].responded, 1);
  eq("week 2 applied", m.cohorts[1].applied, 2);
  eq("week 2 interviewed", m.cohorts[1].interviewed, 2);
  eq("cohorts are ordered oldest first", m.cohorts[0].week < m.cohorts[2].week, true);
}

// ── empty pipeline must not divide by zero ──────────────────────────────────
{
  const empty = computePipelineMetrics([], [], NOW);
  eq("no jobs → no response rate", empty.responseRate, null);
  eq("no jobs → no median", empty.medianDaysToFirstResponse, null);
  eq("no jobs → empty breakdown", empty.furthestBreakdown.every((f) => f.count === 0), true);
  eq("no jobs → no cohorts", empty.cohorts.length, 0);
}

// ── ISO week keys ───────────────────────────────────────────────────────────
{
  eq("2026-10-27 is week 44", isoWeek(new Date("2026-10-27T12:00:00Z")), "2026-W44");
  eq("2026-01-01 is week 1 of 2026", isoWeek(new Date("2026-01-01T12:00:00Z")), "2026-W01");
  eq("weeks sort chronologically as strings", "2026-W09" < "2026-W10", true);
}

console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
