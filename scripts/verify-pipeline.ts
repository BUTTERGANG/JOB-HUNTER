/**
 * End-to-end pipeline verification.
 *
 * Exercises every stage of the app against a running dev server and asserts on
 * the real responses and the real database rows — not on the code's intent:
 *
 *   1. LLM provider reachable
 *   2. Scrape (Python jobspy) → listings persisted with pay unit + signals
 *   3. Rank → job_analysis rows with axes, hours verdict, flags, penalties
 *   4. Scrape history + run detail
 *   5. Market analysis aggregation
 *   6. Import scraped listings into the tracker
 *   7. Tracked-job detail + listing availability recheck
 *   8. Resume: master resume → tailored JSON → DOCX export
 *   9. Dashboard aggregation
 *  10. Paste-a-posting analysis (extraction + ranking)
 *
 * The master resume used for stage 8 is a PLACEHOLDER written by this script and
 * removed at the end, so it never masquerades as the real one.
 *
 * Run: node_modules/.bin/tsx scripts/verify-pipeline.ts
 *      BASE=http://localhost:3002 node_modules/.bin/tsx scripts/verify-pipeline.ts
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

/* eslint-disable @typescript-eslint/no-explicit-any -- this harness consumes arbitrary JSON
   from HTTP endpoints and asserts on whichever fields each stage produces. Narrowing every
   field into interfaces would add a lot of noise without adding safety to a verification
   script whose job is to observe what the app actually returns. */

const BASE = process.env.BASE || "http://localhost:3002";

interface Stage {
  name: string;
  ok: boolean;
  detail: string;
}
const stages: Stage[] = [];
let hardFailures = 0;

function record(name: string, ok: boolean, detail: string) {
  stages.push({ name, ok, detail });
  if (!ok) hardFailures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n        ${detail}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ApiResult {
  status: number;
  json: any;
  raw: string;
}

async function api(method: string, path: string, body?: unknown, retries = 2): Promise<ApiResult> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* non-JSON (e.g. docx) */
    }
    // The app rate-limits per endpoint; a 429 here is a test artefact, not a bug.
    if (res.status === 429 && attempt < retries) {
      console.log(`        (429 on ${path} — waiting 20s for the rate-limit window)`);
      await sleep(20_000);
      continue;
    }
    return { status: res.status, json, raw };
  }
}

async function main() {
  console.log(`=== JOB-HUNTER pipeline verification against ${BASE} ===\n`);

  // ── 0. Server up ────────────────────────────────────────────────────────────
  try {
    const home = await fetch(`${BASE}/`);
    record("server responds", home.status === 200, `GET / → ${home.status}`);
  } catch (e) {
    record("server responds", false, `cannot reach ${BASE} — is the dev server running? (${e})`);
    return finish();
  }

  // ── 1. LLM provider ─────────────────────────────────────────────────────────
  const settings = await api("GET", "/api/settings");
  const llm = settings.json?.llm;
  record(
    "LLM configured",
    settings.status === 200 && !!llm?.keyAvailable,
    `provider=${llm?.provider} keySource=${llm?.keySource} ranker=${llm?.models?.ranker}`
  );

  const test = await api("POST", "/api/ai/test", { role: "ranker" });
  record(
    "LLM reachable (live completion)",
    test.status === 200 && test.json?.ok === true,
    test.json?.ok ? `${test.json.model} in ${test.json.ms}ms` : `error: ${test.json?.error}`
  );

  // ── 2. Scrape ───────────────────────────────────────────────────────────────
  // skipDedupe keeps this stage idempotent: without it a second run of this script
  // correctly finds every listing already seen and returns nothing, which looks like
  // a broken scraper. Cross-run dedupe is asserted separately below.
  const SCRAPE_SEARCH = { term: "photographer", location: "Indianapolis, IN" };
  const scrape = await api("POST", "/api/scrape", {
    searches: [SCRAPE_SEARCH],
    sites: ["indeed"],
    results: 25,
    hours: 168,
    skipDedupe: true,
  });
  const jobs: any[] = scrape.json?.jobs ?? [];
  const withAnalysis = jobs.filter((j) => j.analysis);
  record(
    "scrape returns listings",
    scrape.status === 200 && jobs.length > 0,
    scrape.status !== 200
      ? `HTTP ${scrape.status}: ${JSON.stringify(scrape.json).slice(0, 300)}`
      : `${jobs.length} listings (dedupe: ${JSON.stringify(scrape.json?.dedupe)})`
  );
  record(
    "scrape → rank in one pass",
    withAnalysis.length === jobs.length && jobs.length > 0,
    `${withAnalysis.length}/${jobs.length} listings came back ranked`
  );

  const sample = withAnalysis[0];
  if (sample) {
    const a = sample.analysis;
    const fields = {
      rankScore: a.rankScore,
      payLabel: a.payLabel,
      payInterval: a.payInterval,
      interest: a.scoreInterest,
      engagement: a.scoreEngagement,
      hoursVerdict: a.hoursVerdict?.flag ?? "meets",
      penalties: Array.isArray(a.penalties) ? a.penalties.length : "missing",
      flags: Array.isArray(a.flags) ? a.flags.length : "missing",
    };
    record(
      "ranked listing carries the new fields",
      typeof a.rankScore === "number" &&
        typeof a.payLabel === "string" &&
        a.scoreInterest != null &&
        a.scoreEngagement != null &&
        a.hoursVerdict != null &&
        Array.isArray(a.penalties) &&
        Array.isArray(a.flags),
      JSON.stringify(fields)
    );
  }

  // ── 2b. Cross-run dedupe ────────────────────────────────────────────────────
  // The same search again, with dedupe ON (the default): every listing was just
  // stored, so it must be recognised as previously seen and filtered out.
  const reScrape = await api("POST", "/api/scrape", {
    searches: [SCRAPE_SEARCH],
    sites: ["indeed"],
    results: 25,
    hours: 168,
  });
  const d = reScrape.json?.dedupe;
  record(
    "cross-run dedupe recognises already-seen listings",
    reScrape.status === 200 && (d?.previousRunDuplicates ?? 0) > 0 && (d?.outputCount ?? 0) === 0,
    `input=${d?.inputCount} withinRun=${d?.withinRunDuplicates} previousRun=${d?.previousRunDuplicates} output=${d?.outputCount}`
  );

  // ── 3. Scrape history + detail ──────────────────────────────────────────────
  const runs = await api("GET", "/api/scrapes");
  const runList: any[] = runs.json?.runs ?? runs.json?.scrapes ?? (Array.isArray(runs.json) ? runs.json : []);
  // The newest run may legitimately be empty (the dedupe re-scrape above), so pick
  // the newest one that actually stored listings.
  const foundCount = (r: any) => Number(r?.totalFound ?? r?.total_found ?? r?.count ?? 0);
  const runId = (runList.find((r) => foundCount(r) > 0) ?? runList[0])?.id;
  record(
    "scrape run persisted",
    runs.status === 200 && runList.length > 0,
    `${runList.length} run(s); latest id=${runId}`
  );

  if (runId) {
    const detail = await api("GET", `/api/scrapes/${runId}`);
    const results: any[] = detail.json?.results ?? [];
    const ranked = results.filter((r) => r.analysis);
    record(
      "run detail returns results + analyses",
      detail.status === 200 && results.length > 0 && ranked.length > 0,
      `${results.length} results, ${ranked.length} analysed, ` +
        `pay unit on first: ${ranked[0]?.analysis?.payLabel ?? "-"}`
    );
  }

  // ── 4. Market analysis ──────────────────────────────────────────────────────
  const market = await api("GET", "/api/analysis/market");
  const m = market.json;
  record(
    "market analysis aggregates",
    market.status === 200 &&
      typeof m?.totalUnique === "number" &&
      m.totalUnique > 0 &&
      Array.isArray(m?.sectorBreakdown),
    `unique=${m?.totalUnique} raw=${m?.totalRaw} removed=${m?.duplicatesRemoved} ` +
      `sectors=${m?.sectorBreakdown?.length} sources=${m?.sourceBreakdown?.length}`
  );

  // ── 5. Import into the tracker ──────────────────────────────────────────────
  const toImport = withAnalysis.slice(0, 2).map((j) => ({
    role: j.role,
    company: j.company,
    location: j.location,
    url: j.url,
    source: j.source,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    description: j.description,
  }));
  const imp = await api("POST", "/api/jobs/import", { jobs: toImport });
  const accountedFor = (imp.json?.created ?? 0) + (imp.json?.skippedDuplicates ?? 0);
  record(
    "import scraped listings into the tracker",
    (imp.status === 200 || imp.status === 201) &&
      accountedFor === toImport.length &&
      (imp.json?.errors?.length ?? 0) === 0,
    `sent=${toImport.length} created=${imp.json?.created} skippedDuplicates=${imp.json?.skippedDuplicates} ` +
      `errors=${imp.json?.errors?.length ?? 0} (every input accounted for)`
  );

  const jobList = await api("GET", "/api/jobs");
  const tracked: any[] = Array.isArray(jobList.json) ? jobList.json : (jobList.json?.jobs ?? []);
  const trackedWithUrl = tracked.find((j) => j.url);
  record(
    "tracked jobs listed",
    jobList.status === 200 && tracked.length > 0,
    `${tracked.length} tracked job(s); first with URL: ${trackedWithUrl?.id ?? "none"}`
  );

  if (trackedWithUrl) {
    const detail = await api("GET", `/api/jobs/${trackedWithUrl.id}`);
    record(
      "tracked job detail",
      detail.status === 200 && detail.json?.role === trackedWithUrl.role,
      `id=${trackedWithUrl.id} role="${detail.json?.role}" status=${detail.json?.status}`
    );

    const check = await api("POST", `/api/jobs/${trackedWithUrl.id}/check-listing`);
    const status = check.json?.job?.listingStatus ?? check.json?.listingStatus ?? check.json?.status;
    record(
      "listing availability recheck",
      check.status === 200 && !!status,
      `classified as "${status}" for ${trackedWithUrl.url?.slice(0, 60)}…`
    );
  }

  // ── 5b. Rate-limit isolation ────────────────────────────────────────────────
  // Regression guard: every limiter used to share one counter, so ~10 requests to
  // ANY route exhausted the AI budget (10/min) and a bulk-scan call could lock out
  // the whole API for five minutes. Hammer a general route, then confirm an AI route
  // still has budget.
  let general429 = 0;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${BASE}/api/dashboard`);
    if (r.status === 429) general429++;
  }
  const afterFlood = await api("POST", "/api/ai/test", { role: "ranker" });
  const policy = afterFlood.json?.ok ? "ai budget intact" : "ai budget exhausted";
  record(
    "rate limiters are isolated per endpoint",
    general429 === 0 && afterFlood.status === 200,
    `20 general requests → ${general429} throttled; AI route after the flood → ${afterFlood.status} (${policy})`
  );

  // ── 6. Resume pipeline ──────────────────────────────────────────────────────
  const PLACEHOLDER = `PLACEHOLDER RESUME — written by scripts/verify-pipeline.ts to test the
resume pipeline. Not a real resume. Alex Example, Indianapolis IN.

EXPERIENCE
Wedding DJ & Event Photographer — 2019-Present
- Performed 120+ weddings and events, mixed live audio for 400-guest receptions.
- Second-shot 40+ weddings; culled and delivered galleries within 48 hours.
- Managed client bookings, contracts and vendor coordination.

EDUCATION
Some college coursework, no degree.
`;
  const save = await api("PUT", "/api/settings", { masterResume: PLACEHOLDER });
  record("master resume saved", save.status === 200 && save.json?.success === true, `HTTP ${save.status}`);

  const target = trackedWithUrl ?? tracked[0];
  const desc =
    target?.description ||
    "Wedding videographer. Shoot and edit weddings, own gear required, weekends, $60/hr.";

  const tailor = await api("POST", "/api/ai/tailor", {
    description: desc,
    jobId: target?.id,
  });
  const resume = tailor.json?.content;
  record(
    "resume tailoring (structured JSON)",
    tailor.status === 200 &&
      resume &&
      typeof resume === "object" &&
      typeof resume.professionalSummary === "string",
    tailor.status !== 200
      ? `HTTP ${tailor.status}: ${JSON.stringify(tailor.json).slice(0, 200)}`
      : `name="${resume.name}" tagline="${resume.tagline}" roles=${resume.professionalExperience?.length ?? 0} legacy=${!!tailor.json?.isLegacy}`
  );

  if (target?.id && resume && typeof resume === "object") {
    const stored = await api("GET", `/api/jobs/${target.id}/resume`);
    record(
      "tailored resume persisted",
      stored.status === 200 && !!stored.json?.content,
      `GET /api/jobs/${target.id}/resume → ${stored.status}`
    );

    const docx = await fetch(`${BASE}/api/jobs/${target.id}/resume/docx`);
    const buf = Buffer.from(await docx.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // DOCX is a zip container
    record(
      "DOCX export",
      docx.status === 200 && isZip && buf.length > 2000,
      `HTTP ${docx.status} ${buf.length} bytes, zip magic=${isZip}, type=${docx.headers.get("content-type")}`
    );
  }

  // ── 7. Dashboard ────────────────────────────────────────────────────────────
  const dash = await api("GET", "/api/dashboard");
  record(
    "dashboard aggregation",
    dash.status === 200 && dash.json?.scrape?.total > 0,
    `scraped=${dash.json?.scrape?.total} analyzed=${dash.json?.scrape?.analyzed} avgScore=${dash.json?.scrape?.avgScore}`
  );

  // ── 8. Paste-a-posting path ─────────────────────────────────────────────────
  const paste = await api("POST", "/api/analyze-url", {
    description:
      "Event Photographer — 15 hours per week, $50 per hour, Indianapolis. Self-scheduled weekend bookings, own camera required, portfolio required, no degree necessary.",
  });
  const pa = paste.json?.analysis;
  record(
    "paste-a-posting extraction + ranking",
    paste.status === 200 && !!paste.json?.job?.role && typeof pa?.rankScore === "number",
    paste.status !== 200
      ? `HTTP ${paste.status}: ${JSON.stringify(paste.json).slice(0, 200)}`
      : `role="${paste.json.job.role}" pay=${pa.payLabel} hours=${pa.hoursVerdict?.flag ?? "meets"} score=${pa.rankScore}`
  );
  record(
    "earnings-aware rule survives the whole path",
    pa?.hoursVerdict?.basis === "earnings" && pa?.hoursVerdict?.penaltyPoints === 0,
    `basis=${pa?.hoursVerdict?.basis} earnings=$${pa?.hoursVerdict?.weeklyEarnings}/wk penalty=${pa?.hoursVerdict?.penaltyPoints}`
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  // Remove BOTH the placeholder master resume and any tailored resumes generated
  // from it. Leaving the tailored ones behind is worse than leaving the master:
  // the job detail page would show a resume built from fake experience.
  //
  // The tailored rows are deleted directly through the SQLite file (there is no
  // delete endpoint for a single resume), matching only rows that contain this
  // script's marker so a real resume can never be caught by it.
  const cleanup = await api("PUT", "/api/settings", { masterResume: "" });
  let removedTailored = 0;
  try {
    const dbPath = path.resolve(process.cwd(), "data", "jobhunt.db");
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      const info = db
        // Match the placeholder NAME as well as the marker text: the model rewrites
        // the resume body, so the literal marker may not survive into the JSON.
        .prepare(
          "DELETE FROM resumes WHERE type = 'tailored' AND (content LIKE ? OR content LIKE ?)"
        )
        .run("%PLACEHOLDER RESUME%", "%Alex Example%");
      removedTailored = info.changes ?? 0;
      db.close();
    }
  } catch (e) {
    console.log(`        (could not clean tailored resumes: ${e instanceof Error ? e.message : e})`);
  }
  record(
    "placeholder resume removed",
    cleanup.status === 200,
    `master resume cleared; ${removedTailored} placeholder-derived tailored resume(s) deleted`
  );

  finish();
}

function finish() {
  const passed = stages.filter((s) => s.ok).length;
  console.log(`\n=== ${passed}/${stages.length} stages passed ===`);
  if (hardFailures > 0) {
    console.log("FAILED STAGES:");
    for (const s of stages.filter((x) => !x.ok)) console.log(`  - ${s.name}: ${s.detail}`);
  }
  process.exit(hardFailures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verifier crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
