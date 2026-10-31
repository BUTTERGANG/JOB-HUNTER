/**
 * End-to-end verification of the resume arsenal against the real database.
 *
 *   node_modules/.bin/tsx scripts/verify-arsenal.ts
 *
 * Creates marked test jobs and resumes, exercises tailoring → recommending → reusing,
 * asserts on what the database actually contains, then deletes everything it created.
 */

import {
  createJob,
  deleteJob,
  deleteResume,
  getArsenalCandidates,
  getJobById,
  getResumeById,
  getTailoredResume,
  listResumes,
  renameResume,
  recommendResumeForJob,
  reuseResumeForJob,
  saveTailoredResume,
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
const MARK = `__arsenal-${STAMP}__`;

const TAILORED_JSON = JSON.stringify({
  name: "Alex Butterfield",
  tagline: "Wedding Videographer",
  professionalSummary: "Wedding and live-event videographer.",
  coreCompetencies: { technical: ["Video editing", "Camera operation"], operations: ["Client management"] },
  professionalExperience: [{ title: "Wedding Videographer", company: "LA MEDIA" }],
});

const jobs: number[] = [];
const resumeIds: number[] = [];

try {
  console.log("── a job gets tailored, and the resume lands in the arsenal ──");
  const source = createJob({ company: `${MARK} Danbren`, role: "Wedding Videographer", status: "applied" });
  const other = createJob({ company: `${MARK} Warehouse`, role: "Warehouse Associate", status: "saved" });
  jobs.push(source!.id, other!.id);

  const saved = saveTailoredResume(source!.id, TAILORED_JSON, {
    label: "Wedding videographer — Danbren",
    roleTitle: "Wedding Videographer",
    keywords: ["wedding", "videography", "editing", "camera"],
  });
  resumeIds.push(saved!.id);

  eq("metadata is persisted", saved?.label, "Wedding videographer — Danbren");
  eq("keywords are stored as JSON", JSON.parse(saved!.keywords!), ["wedding", "videography", "editing", "camera"]);

  const listed = listResumes().find((r) => r.id === saved!.id);
  check("the resume appears in the arsenal", !!listed);
  eq("…with its source job", listed?.company, `${MARK} Danbren`);
  check("…and a size", (listed?.chars ?? 0) > 100, `chars: ${listed?.chars}`);

  // ── recommending ────────────────────────────────────────────────────────
  console.log("\n── recommending for a similar job ──");
  const similar = createJob({ company: `${MARK} Other Video Co`, role: "Wedding Videographer", status: "saved" });
  jobs.push(similar!.id);

  const rec = recommendResumeForJob(similar!.id);
  check("a recommendation is produced", !!rec);
  eq("…and it is the wedding video resume", rec?.recommendation.best?.id, saved!.id);
  eq("…with a reuse verdict", rec?.recommendation.verdict, "reuse");
  check("…and a score worth trusting", (rec?.recommendation.best?.match.score ?? 0) >= 65, `score: ${rec?.recommendation.best?.match.score}`);

  console.log("\n── recommending for an unrelated job ──");
  // NOTE: this cannot assert "verdict !== reuse". The real master resume is in the arsenal
  // and genuinely contains the Amazon warehouse role, so it legitimately wins this job.
  // (First draft of this test asserted the verdict and failed — the matcher was right and
  // the test was naive.) The meaningful assertion is that the WEDDING resume is not the
  // pick, i.e. verticals are distinguished by actual content.
  const unrelated = recommendResumeForJob(other!.id);
  check(
    "an unrelated job is not offered the wedding video resume",
    unrelated?.recommendation.best?.id !== saved!.id,
    `top pick was #${unrelated?.recommendation.best?.id} (${unrelated?.recommendation.best?.label})`
  );
  check("…and the recommendation explains itself", (unrelated?.recommendation.reason ?? "").length > 10);

  // A job must never be recommended its own resume.
  const own = recommendResumeForJob(source!.id);
  eq("a job is never offered its own resume", own?.recommendation.best?.id === saved!.id, false);

  // ── reusing ─────────────────────────────────────────────────────────────
  console.log("\n── reusing it for the similar job ──");
  const reused = reuseResumeForJob(similar!.id, saved!.id);
  resumeIds.push(reused!.id);

  eq("the copy is marked reused", reused?.type, "reused");
  eq("…and records its provenance", reused?.sourceResumeId, saved!.id);
  check("…and carries the content", (reused?.content.length ?? 0) > 100);

  const after = getResumeById(saved!.id);
  eq("the original's reuse count increments", after?.reuseCount, 1);

  // The detail page and DOCX export both read the newest row for a job — the copy must be
  // what they find, or a reused resume would appear nowhere.
  const attached = getTailoredResume(similar!.id);
  eq("the job now resolves to the reused resume", attached?.id, reused!.id);
  eq("…with the content intact", JSON.parse(attached!.content).tagline, "Wedding Videographer");

  const candidates = getArsenalCandidates();
  check("the original is a matchable candidate", candidates.some((c) => c.id === saved!.id));
  // A reused row is a COPY of another resume. Letting copies compete let a copy of the
  // master outrank a purpose-built resume for the same job, so copies are excluded.
  check(
    "…and its reused copy is NOT (copies would compete with the original)",
    !candidates.some((c) => c.id === reused!.id)
  );

  // ── rename + delete ─────────────────────────────────────────────────────
  console.log("\n── rename and delete ──");
  const renamed = renameResume(saved!.id, "Renamed by the harness");
  eq("a resume can be renamed", renamed?.label, "Renamed by the harness");

  deleteResume(reused!.id);
  resumeIds.splice(resumeIds.indexOf(reused!.id), 1);
  eq("deleting removes it from the arsenal", listResumes().some((r) => r.id === reused!.id), false);
  eq("…and the job no longer resolves a resume", getTailoredResume(similar!.id), undefined);
} finally {
  console.log("\n── cleanup ──");
  for (const id of resumeIds) {
    try {
      deleteResume(id);
    } catch {
      /* already gone */
    }
  }
  for (const id of jobs) {
    try {
      deleteJob(id);
    } catch {
      /* already gone */
    }
  }
  const leftoverResumes = listResumes().filter((r) => (r.label ?? "").includes("harness") || (r.company ?? "").includes(MARK));
  eq("no test resumes left behind", leftoverResumes.length, 0);
  const leftoverJobs = jobs.map((id) => getJobById(id)).filter(Boolean);
  eq("no test jobs left behind", leftoverJobs.length, 0);
}

console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
