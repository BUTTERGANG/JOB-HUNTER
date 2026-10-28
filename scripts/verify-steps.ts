/**
 * End-to-end verification of next steps + stage history against the real database.
 *
 *   node_modules/.bin/tsx scripts/verify-steps.ts
 *
 * Creates one clearly-marked test job, drives it through the pipeline, asserts on what
 * the database actually contains, then deletes it — the cascade takes its steps and
 * events with it, so real data is never touched.
 */

import {
  addJobStep,
  completeJobStep,
  createJob,
  deleteJob,
  getAllStageEvents,
  getJobById,
  getJobStageEvents,
  getJobSteps,
  getOpenSteps,
  getPipelineMetrics,
  updateJob,
} from "../src/lib/db/queries";
import { ensureDb } from "../src/lib/db/ensure";

ensureDb();

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T) {
  const same =
    typeof actual === "object" && actual !== null
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : Object.is(actual, expected);
  check(name, same, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const STAMP = Date.now();
const COMPANY = `__verify-steps-${STAMP}__`;

console.log("── creating a job at 'saved' ──");
const job = createJob({ company: COMPANY, role: "Verification Role", status: "saved" });
check("job created", !!job?.id);

if (!job) {
  console.log("could not create the test job — aborting");
  process.exit(1);
}

try {
  // ── birth: history starts, a next step appears ──────────────────────────
  const birthEvents = getJobStageEvents(job.id);
  eq("an initial stage event is recorded", birthEvents.length, 1);
  eq("…from null (creation)", birthEvents[0].fromStatus, null);
  eq("…to saved", birthEvents[0].toStatus, "saved");

  let steps = getJobSteps(job.id);
  eq("a next step is proposed automatically", steps.length, 1);
  eq("…and it is Apply", steps[0].label, "Apply");
  eq("…and it starts open", steps[0].completedAt, null);

  const inQueue = getOpenSteps().filter((s) => s.jobId === job.id);
  eq("the step shows up in the open queue", inQueue.length, 1);
  eq("…carrying its job context", inQueue[0].company, COMPANY);

  // ── completing Apply advances the status and dates it ───────────────────
  console.log("\n── completing the Apply step ──");
  const completed = completeJobStep(steps[0].id);
  check("the step is marked complete", !!completed?.completedAt);

  const afterApply = getJobById(job.id);
  eq("completing Apply moves the job to applied", afterApply?.status, "applied");
  check(
    "…and dates the application (the metrics need it)",
    /^\d{4}-\d{2}-\d{2}$/.test(afterApply?.dateApplied ?? ""),
    `dateApplied: ${afterApply?.dateApplied}`
  );

  const applyEvents = getJobStageEvents(job.id);
  eq("the transition is logged", applyEvents.length, 2);
  eq("…saved → applied", [applyEvents[1].fromStatus, applyEvents[1].toStatus], ["saved", "applied"]);

  steps = getJobSteps(job.id);
  const openAfter = steps.filter((s) => s.completedAt === null);
  eq("exactly one open step remains", openAfter.length, 1);
  check(
    "…and it is the follow-up",
    /follow up/i.test(openAfter[0].label),
    `got: ${openAfter[0].label}`
  );
  eq("completed steps are kept, not deleted", steps.length, 2);

  // ── ensureNextStep must not stack duplicates ────────────────────────────
  updateJob(job.id, { notes: "touched without changing status" });
  eq("a non-status edit adds no step", getJobSteps(job.id).length, 2);
  eq("…and no stage event", getJobStageEvents(job.id).length, 2);

  // ── advancing stages ────────────────────────────────────────────────────
  console.log("\n── advancing to phone screen, then onsite ──");
  updateJob(job.id, { status: "phone_screen" });
  updateJob(job.id, { status: "onsite" });

  const advanced = getJobStageEvents(job.id);
  eq("every transition is logged", advanced.length, 4);
  eq(
    "…in order",
    advanced.map((e) => e.toStatus),
    ["saved", "applied", "phone_screen", "onsite"]
  );

  const progress = getPipelineMetrics().progress.find((p) => p.jobId === job.id);
  eq("progress reports the furthest stage", progress?.furthestStage, "onsite");
  eq("…and that an interview was reached", progress?.reachedInterview, true);
  eq("…and no offer", progress?.reachedOffer, false);

  // ── a rejection keeps the furthest stage ────────────────────────────────
  console.log("\n── rejecting it ──");
  updateJob(job.id, { status: "rejected" });
  const rejected = getPipelineMetrics().progress.find((p) => p.jobId === job.id);
  eq("the outcome is recorded", rejected?.outcome, "rejected");
  eq("but the furthest stage survives", rejected?.furthestStage, "onsite");
  eq("…so it still counts as having reached an interview", rejected?.reachedInterview, true);

  const openAtEnd = getJobSteps(job.id).filter((s) => s.completedAt === null);
  // One step is left over from the advance to onsite; a closed pipeline must not add more.
  eq("a rejected job gets no new steps", openAtEnd.length, 1);
  check(
    "the closed job drops out of the actionable queue once its step is done",
    (() => {
      if (openAtEnd[0]) completeJobStep(openAtEnd[0].id);
      return getOpenSteps().filter((s) => s.jobId === job.id).length === 0;
    })()
  );
  eq("a terminal status proposes nothing new", getJobSteps(job.id).filter((s) => s.completedAt === null).length, 0);

  // ── custom steps still work ─────────────────────────────────────────────
  const custom = addJobStep({ jobId: job.id, label: "Ask for feedback", detail: "Short, gracious note." });
  check("a custom step can be added", !!custom?.id, `got id ${custom?.id}`);
  check("…and it starts open", custom?.completedAt === null);
} finally {
  console.log("\n── cleanup ──");
  const before = getAllStageEvents().filter((e) => e.jobId === job.id).length;
  check("the test job had events before deletion", before > 0);
  deleteJob(job.id);
  eq("the job is gone", getJobById(job.id), undefined);
  eq("its steps are cascade-deleted", getJobSteps(job.id).length, 0);
  eq("its stage events are cascade-deleted", getJobStageEvents(job.id).length, 0);
  check(
    "no orphaned events remain",
    getAllStageEvents().every((e) => e.jobId !== job.id)
  );
  eq("and no steps leak into the open queue", getOpenSteps().filter((s) => s.company === COMPANY).length, 0);
}

console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
