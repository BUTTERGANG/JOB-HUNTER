/**
 * One-time backfill for jobs that predate the step/stage tables.
 *
 *   node_modules/.bin/tsx scripts/backfill-pipeline-history.ts [--dry-run]
 *
 * Jobs tracked before this feature have no stage events and no next step, so they would
 * simply not appear in the queue. For each one this seeds an initial stage event from its
 * CURRENT status (we have no earlier history to reconstruct) and proposes a next step.
 *
 * Idempotent: re-running changes nothing. Safe to run against a live database.
 */

import { ensureDb } from "../src/lib/db/ensure";
import { getAllJobs, getJobStageEvents, getJobSteps, ensureNextStep, recordStageEvent } from "../src/lib/db/queries";
import { isTerminalStatus, proposeNextStep } from "../src/lib/pipeline";

ensureDb();

const dryRun = process.argv.includes("--dry-run");

const jobs = getAllJobs();
let seededEvents = 0;
let seededSteps = 0;
let skippedTerminal = 0;

console.log(`${jobs.length} tracked job(s)${dryRun ? " (dry run — nothing will be written)" : ""}\n`);

for (const job of jobs) {
  const events = getJobStageEvents(job.id);
  const openSteps = getJobSteps(job.id).filter((s) => s.completedAt === null);
  const notes: string[] = [];

  if (events.length === 0) {
    notes.push(`seed stage event → ${job.status}`);
    if (!dryRun) recordStageEvent(job.id, null, job.status, "import");
    seededEvents++;
  }

  if (openSteps.length === 0) {
    const suggestion = proposeNextStep({
      status: job.status,
      dateApplied: job.dateApplied,
      followUpDate: job.followUpDate,
    });
    if (suggestion) {
      notes.push(`propose step → ${suggestion.label}`);
      if (!dryRun) ensureNextStep(job.id);
      seededSteps++;
    } else if (isTerminalStatus(job.status)) {
      notes.push("terminal — no step (correct)");
      skippedTerminal++;
    }
  }

  console.log(
    `  #${job.id} ${job.company} — ${job.role} [${job.status}]${notes.length ? "\n      " + notes.join("\n      ") : "\n      already up to date"}`
  );
}

console.log(
  `\nseeded ${seededEvents} stage event(s), ${seededSteps} next step(s); ${skippedTerminal} terminal job(s) left alone`
);
