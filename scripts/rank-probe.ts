/**
 * Live ranking probe.
 *
 * Runs the real ranker (the app's own `analyzeJobsBatch`, through whatever
 * provider/key is configured — OpenRouter here) against the real listings the
 * scraper returned for the target vertical, plus two control listings, and
 * prints what the model actually produced.
 *
 * This is the end-to-end check the offline harness cannot do: it proves the
 * prompt, the profile and the JSON contract work against a live model.
 *
 * Run: node_modules/.bin/tsx scripts/rank-probe.ts
 */

import fs from "fs";
import { analyzeJobsBatch, type JobInput } from "@/lib/ai/analyzeJobs";
import { getLlmConfig } from "@/lib/ai/llm";
import { getTargetProfile } from "@/lib/db/queries";

const PROBE_JSON =
  process.env.PROBE_JSON || "/Users/massmac/.hermes/cache/scratch/probe_results.json";

interface RawRow {
  title?: string;
  company?: string;
  location?: string;
  job_url?: string;
  min_amount?: number | null;
  max_amount?: number | null;
  interval?: string | null;
  job_type?: string | null;
  description?: string | null;
  is_remote?: boolean | null;
  company_industry?: string | null;
}

function dedupe(rows: RawRow[]): RawRow[] {
  const seen = new Set<string>();
  const out: RawRow[] = [];
  for (const r of rows) {
    const url = typeof r.job_url === "string" ? r.job_url : "";
    const key = url.includes("jk=") ? url.split("jk=")[1] : url || `${r.title}|${r.company}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function toJobInput(r: RawRow): JobInput {
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    role: str(r.title) ?? "",
    company: str(r.company) ?? "",
    location: str(r.location),
    salaryMin: num(r.min_amount),
    salaryMax: num(r.max_amount),
    salaryInterval: str(r.interval),
    jobType: str(r.job_type),
    description: str(r.description),
    isRemote: r.is_remote ?? null,
    companyIndustry: str(r.company_industry),
  };
}

async function main() {
  const cfg = getLlmConfig();
  const profile = getTargetProfile();
  console.log("=== LIVE RANKING PROBE ===");
  console.log(`provider: ${cfg.provider}  key: ${cfg.keySource}  model: ${cfg.models.ranker}`);
  console.log(`interests: ${profile.interests.slice(0, 6).join(", ")}…`);
  console.log(`min weekly hours: ${profile.work.minWeeklyHours}\n`);

  if (!fs.existsSync(PROBE_JSON)) {
    console.error(`Probe data not found: ${PROBE_JSON}`);
    process.exit(1);
  }
  // pandas writes bare NaN/Infinity into the dump, which JSON.parse rejects.
  const text = fs
    .readFileSync(PROBE_JSON, "utf8")
    .replace(/\bNaN\b/g, "null")
    .replace(/\b-?Infinity\b/g, "null");
  const raw = JSON.parse(text) as { rows: RawRow[] };
  const real = dedupe(raw.rows || []).map(toJobInput);

  const controls: JobInput[] = [
    {
      role: "Software Engineer",
      company: "CONTROL (off-profile, remote, high pay)",
      location: "Remote",
      salaryMin: 130000,
      salaryMax: 150000,
      salaryInterval: "yearly",
      jobType: "fulltime",
      description:
        "Remote software engineering role. Build distributed services in TypeScript and Go. Bachelor's degree required. Standard Monday-Friday schedule, full benefits, 401k match.",
      isRemote: true,
    },
    {
      role: "Warehouse Associate",
      company: "CONTROL (off-profile, on-site, Mon-Fri)",
      location: "Indianapolis, IN",
      salaryMin: 40000,
      salaryMax: 45000,
      salaryInterval: "yearly",
      jobType: "fulltime",
      description:
        "Warehouse associate. Pick and pack orders, operate pallet jack. No degree required, will train. Monday-Friday day shift, overtime available.",
      isRemote: false,
    },
  ];

  const jobs = [...real, ...controls];
  console.log(`Ranking ${jobs.length} listings (${real.length} real + ${controls.length} control)…\n`);

  const started = Date.now();
  const results = await analyzeJobsBatch(jobs, profile);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const rows = jobs.map((j, i) => ({ job: j, a: results[i] }));
  rows.sort((x, y) => (y.a?.rankScore ?? 0) - (x.a?.rankScore ?? 0));

  console.log("rank  score  pay  int  resp  hrs  flex  loc  acc  eng   pay unit        hours verdict");
  console.log("-".repeat(112));
  for (const { job, a } of rows) {
    if (!a) {
      console.log(`???   ---    ${job.role}`);
      continue;
    }
    const h = a.hoursVerdict;
    // Label from the rule's own flag, not from meetsMin/justified — an unstated
    // schedule is neither a pass nor a penalty.
    const verdictLabel = !h
      ? "-"
      : h.flag === null
        ? "meets minimum"
        : h.flag === "hours:under-min-justified"
          ? "short but justified"
          : h.flag === "hours:under-min"
            ? "PENALISED (short, no justification)"
            : "hours not stated (no penalty)";
    const verdict = h ? `${h.effectiveHours ?? "?"}h → ${verdictLabel}` : "-";
    console.log(
      `${String(a.rankScore).padStart(4)}  ${String(a.scorePay).padStart(3)}  ${String(a.scoreInterest ?? "-").padStart(3)}  ` +
        `${String(a.scoreResponsibilities).padStart(4)}  ${String(a.scoreHours).padStart(3)}  ${String(a.scoreFlexibility).padStart(4)}  ` +
        `${String(a.scoreLocation).padStart(3)}  ${String(a.scoreRequirements).padStart(3)}  ${String(a.scoreEngagement ?? "-").padStart(3)}   ` +
        `${(a.payLabel ?? "-").padEnd(15)} ${verdict}`
    );
    console.log(`      ${job.role.slice(0, 45)} @ ${job.company.slice(0, 38)}`);
    if (a.flags?.length) {
      console.log(`      flags: ${a.flags.map((f) => f.label).join(" | ")}`);
    }
    if (a.penalties?.length) {
      console.log(
        `      penalty: ${a.penalties.map((p) => `-${p.points} ${p.label}`).join(", ")}`
      );
    }
    if (a.notes) console.log(`      note: ${a.notes}`);
    console.log("");
  }

  console.log(`elapsed: ${elapsed}s`);

  // Sanity assertions on the live output.
  const realRows = rows.filter((r) => !r.job.company.startsWith("CONTROL"));
  const bestReal = realRows[0];
  const swe = rows.find((r) => r.job.role === "Software Engineer");
  console.log("\n--- live sanity checks ---");
  console.log(
    `best real target listing: ${bestReal?.job.role} = ${bestReal?.a?.rankScore}`
  );
  console.log(`software-engineer control: ${swe?.a?.rankScore}`);
  if (bestReal && swe) {
    console.log(
      bestReal.a!.rankScore >= swe.a!.rankScore
        ? "PASS  a real on-target listing outranks the off-profile control"
        : "FAIL  the off-profile control still outranks every real target listing"
    );
  }
  const truncated = results.filter((r) => !r);
  if (truncated.length) console.log(`WARNING ${truncated.length} listings returned no analysis`);
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
