/**
 * Load a master resume file into the app's settings table.
 *
 * The resume text never passes through the shell, an HTTP body, or any log: this
 * writes it straight into the gitignored SQLite `settings` row and prints only a
 * summary (character count, role headings, contact-line presence). Everything the
 * resume tailor produces is derived from this row, and the tailor prompt is
 * forbidden from inventing facts, so whatever is missing here is missing from
 * every generated resume.
 *
 * Run: node_modules/.bin/tsx scripts/import-master-resume.ts [path] [--dry-run]
 *      (default path: data/master_resume.md)
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find((a) => !a.startsWith("--")) ?? "data/master_resume.md";
const resumePath = path.resolve(process.cwd(), fileArg);
const dbPath = path.resolve(process.cwd(), "data", "jobhunt.db");

if (!fs.existsSync(resumePath)) {
  console.error(`Master resume file not found: ${resumePath}`);
  process.exit(1);
}

const content = fs.readFileSync(resumePath, "utf8");

// ── Sanity checks: a resume that fails these would silently degrade every
//    tailored resume generated from it. ─────────────────────────────────────────
const problems: string[] = [];
// Roles are "## Company — Title" (em dash). The file also has plain "## Education",
// "## Certifications" and similar section headings, which are not roles.
const roleHeadings = (content.match(/^## .+$/gm) ?? []).filter((h) => h.includes("—"));
if (content.trim().length < 500) problems.push("suspiciously short (<500 chars)");
if (roleHeadings.length === 0) problems.push("no '## Role — Title' headings found");
if (/TODO/i.test(content)) {
  problems.push("contains TODO placeholders — they would be treated as experience");
}
if (/\bPresent\b/i.test(content) === false) {
  problems.push("no ongoing role marked Present — check the dates");
}
if (content.length > 60_000) problems.push("very large (>60k chars) — check for duplication");

console.log(`file:        ${resumePath}`);
console.log(`characters:  ${content.length}`);
console.log(`roles:       ${roleHeadings.length}`);
for (const heading of roleHeadings.slice(0, 3)) console.log(`  ${heading}`);
if (roleHeadings.length > 3) console.log(`  … and ${roleHeadings.length - 3} more`);
const hasLinkedIn = /linkedin\.com\/in\//i.test(content);
const hasLocation = /^Location:/im.test(content);
const forbidsInvention = /do not invent/i.test(content);
console.log(
  `contact:     location=${hasLocation ? "yes" : "no"} linkedin=${hasLinkedIn ? "yes" : "no"} ` +
    `no-invent instruction=${forbidsInvention ? "yes" : "no"}`
);
if (!hasLocation) problems.push("no location line — resumes will have an empty contact field");
if (!forbidsInvention) {
  problems.push("no 'do not invent' instruction for contact details");
}

if (problems.length) {
  console.error(`\nREFUSING TO IMPORT — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("checks:      passed");

if (dryRun) {
  console.log("\nDry run — nothing written.");
  process.exit(0);
}

if (!fs.existsSync(dbPath)) {
  console.error(`\nDatabase not found at ${dbPath}. Start the app once so it creates the schema.`);
  process.exit(1);
}

const db = new Database(dbPath);
const before = db
  .prepare("SELECT content FROM resumes WHERE type = 'master' ORDER BY created_at DESC LIMIT 1")
  .get() as { content?: string } | undefined;

// The app reads the master resume through getMasterResume() — the newest `resumes`
// row of type 'master'. Write exactly there so there is one source of truth.
db.prepare("DELETE FROM resumes WHERE type = 'master'").run();
db.prepare("INSERT INTO resumes (job_id, type, content) VALUES (NULL, 'master', ?)").run(content);
db.close();

console.log(
  before?.content
    ? `replaced the stored master resume (was ${before.content.length} chars)`
    : "stored a new master resume"
);
console.log("done — Settings → Master Resume now shows it, and /api/ai/tailor will use it.");
