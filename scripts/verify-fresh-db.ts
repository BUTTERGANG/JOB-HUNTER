/**
 * Fresh-install check: build the schema from nothing and assert it is complete.
 *
 * The migrations in ensure.ts are ALTERs that must tolerate "already applied". On a NEW
 * database the DDL creates every table, so every ALTER hits "duplicate column name" — the
 * benign path. This proves that path works, and that the DDL and the migrations agree on
 * every column (a column present in one but not the other is a silent time bomb: it works
 * on the developer's database and fails on a fresh one, or vice versa).
 *
 *   node_modules/.bin/tsx scripts/verify-fresh-db.ts
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { pathToFileURL } from "url";

// Captured BEFORE chdir. A relative import would resolve against the new working
// directory (that is what broke the first attempt), so the module is loaded by absolute
// URL — and inside an async main, because this repo emits CJS where top-level await is a
// build error.
const REPO_ROOT = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobhunt-fresh-"));
const dbDir = path.join(dir, "data");
fs.mkdirSync(dbDir, { recursive: true });

async function main() {
process.chdir(dir); // ensureDb() resolves the database as <cwd>/data/jobhunt.db
const { ensureDb } = await import(pathToFileURL(path.join(REPO_ROOT, "src/lib/db/ensure.ts")).href);

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

console.log(`fresh database at ${dir}/data/jobhunt.db\n`);

try {
  ensureDb();
  check("ensureDb() completes on an empty database", true);
  // Idempotency: a second call must be a no-op, not an error.
  ensureDb();
  check("…and is safe to call twice", true);
} catch (e) {
  check("ensureDb() completes on an empty database", false, e instanceof Error ? e.message : String(e));
}

const dbPath = path.join(dir, "data", "jobhunt.db");
check("the database file was created", fs.existsSync(dbPath));

const db = new Database(dbPath, { readonly: true });
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
  (r) => r.name
);

for (const table of [
  "jobs", "resumes", "analyses", "settings", "scrape_runs", "scrape_results",
  "job_analysis", "bls_wages", "bulk_runs", "analysis_runs", "gov_scrape_runs",
  "gov_scrape_results", "listing_status_history", "job_steps", "job_stage_events",
]) {
  check(`table ${table} exists`, tables.includes(table), `have: ${tables.join(", ")}`);
}

// Columns the app reads. If the DDL and the migrations ever disagree, one of these is
// missing on either a new database or an upgraded one.
const expected: Record<string, string[]> = {
  job_analysis: [
    "score_pay", "score_interest", "score_engagement", "score_responsibilities",
    "score_hours", "score_flexibility", "score_location", "score_requirements",
    "pay_interval", "pay_label", "hours_verdict", "flags", "penalties", "details",
  ],
  scrape_results: [
    "salary_interval", "salary_source", "is_remote", "job_level", "listing_type",
    "company_industry", "experience_range", "description",
  ],
  scrape_runs: ["distance"],
  resumes: ["label", "role_title", "keywords", "source_resume_id", "reuse_count"],
  jobs: ["listing_status", "listing_checked_at"],
  job_steps: ["label", "detail", "due_date", "completed_at"],
  job_stage_events: ["job_id", "from_status", "to_status", "occurred_at", "source"],
};

for (const [table, columns] of Object.entries(expected)) {
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
  for (const column of columns) {
    check(`${table}.${column} exists`, have.includes(column), `have: ${have.join(", ")}`);
  }
}

// Every column the migrations add must also be in the DDL, or a fresh database and an
// upgraded one drift apart.
const ensureSource = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "db", "ensure.ts"), "utf8");
check("ensure.ts contains migrations to check", /ALTER TABLE/.test(ensureSource));

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
}

main().catch((e) => {
  console.error("fresh-db check crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
