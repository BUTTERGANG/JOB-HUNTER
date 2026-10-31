## 2026-10-31 — The scheduled scrape returns a run id, and the sweep stops lying about failures

The first real daily sweep reported `fetch failed` after 5 minutes — while the server had
successfully scraped 253 new listings and ranked all of them (233 → 486). Two separate
defects were hiding behind one confusing symptom.

- **The endpoint did the work inline.** A scrape plus ranking hundreds of listings runs longer
  than the **300-second headers timeout** HTTP clients enforce by default, and that timeout
  cannot be overridden from the caller. The endpoint now starts a background run and returns
  `202 {runId}`; the caller polls. Applied as a general rule: nothing that takes minutes is
  tied to the lifetime of a request.
- **A failed sweep and a successful one were indistinguishable.** The daily script now polls to
  completion and exits non-zero only for a real failure, with a distinct code (2) when the
  scrape worked but the alert did not.
- Earlier, the same sweep failed instantly on a **broken venv**: Homebrew moved `python@3.11`
  3.11.17_1 → 3.11.18, and a venv built from Homebrew Python links the framework by full
  version path, so the interpreter aborted with "Library not loaded" while the app blamed a
  missing package. Rebuilt, and `checkPythonDependencies` now tells the two apart.

, and generates resumes in batch

- **A daily sweep.** `scripts/daily-scrape.mjs` + `ai.buttergang.job-hunter-daily.plist` POST
  the scheduled-scrape endpoint at 06:15, so scrape → rank → notify all run through the same
  path the UI uses. Search terms, radius and window come from settings.
- **Alerts via the Hermes gateway.** `hermes send --to discord:#thread` replaces the app's own
  webhook as the default transport (`notify_via` still allows `webhook` or `off`). Verified by
  sending a real message into the JOB DASHBOARD thread.
- **Batch resume generation.** Walks the top-scoring untracked listings, **checks the arsenal
  first** and attaches an existing resume when one fits, otherwise tailors. Imports each one to
  the tracker with a next step, runs 2 at a time, reports progress, cancellable.
- **The scheduled path never sent `distance`** — every scheduled run silently used jobspy's
  50-mile default. Now reads `schedule_distance`; defaults moved to the measured 100 / 720.
- **Fixed a Homebrew breakage that had killed all scraping.** `python@3.11` moved 3.11.17_1 →
  3.11.18; a venv built from Homebrew Python links the framework by full version path, so the
  interpreter aborted with "Library not loaded" — and the error pointed at a missing package
  instead. The venv is rebuilt, and `checkPythonDependencies` now distinguishes a broken
  interpreter from a missing package and names the real cause.



Added **docs/security.md** (verdict, evidence, residual risk) and fixed what the assessment
found. Summary: the tailnet is the access-control layer and the app has no application
authentication of its own — adequate for a single-user tool on a private network, not safe to
expose publicly.

- **SSRF was confirmed exploitable** in `/api/analyze-url`: the server fetched a
  request-supplied URL with no validation (proven by aiming it at the app's own `/api/health`),
  and both fetch paths followed redirects into internal addresses. All paths now validate the
  URL, redirects are followed manually with every hop checked, and the curl fallback no longer
  follows them. `verify-safe-fetch.ts` covers 22 refused targets and 6 that must still work.
- **The database was world-readable** (`0644`) while storing the OpenRouter key and PII;
  `ensureDb()` now chmods the DB, WAL and SHM to `0600` (applied to the live file too).
- **`/api/health` was the only route without a rate limiter.**
- **`shadcn` moved to `devDependencies`** — it was a runtime dependency carrying the project's
  only three audit findings. `npm audit` now reports 0 vulnerabilities.
- The SSRF guard first **over-blocked** `192.168.example.com`; range rules are now gated on the
  host being an IPv4 literal.



A sweep for failures that do not announce themselves, plus a build-tracing warning. The full
list, including what was left open, is in docs/decisions.md.

- **Resume hand-edits no longer insert a new arsenal row** (they wiped the label, keywords and
  provenance, and turned a reused resume back into an anonymous tailored one).
- **All stored-JSON parsing is now tolerant** (`src/lib/json.ts`); six unguarded `JSON.parse`
  calls meant one malformed row 500'd the endpoint reading it.
- **Schema migrations only tolerate "already applied".** 36 `catch {}` blocks treated a locked
  database and a typo'd column the same as a completed migration.
- **Deleted dead code that looked alive:** `src/app/api/auth.ts` was a plain `.ts` file, so
  that health check never existed; it was the only importer of `authMiddleware.ts`, which
  duplicated `rateLimit.ts`'s `getClientIdentifier` byte-for-byte. Added a real
  `GET /api/health`.
- **Deleted my own dead exports**, and the dashboard's inlined copy of
  `ACTIVE_INTERVIEW_STATUSES`.
- **Surfaced two client-side silent failures**, one of which could lose work: a failed resume
  load looked identical to "no resume" and invited re-tailoring over an existing one.
- **Added `scripts/verify-fresh-db.ts`** (58 checks) — builds the schema from nothing and
  asserts the DDL and the migrations agree, so a fresh install cannot silently lack a column.

Verified: all six harnesses pass, build and ESLint clean, **no route returns 5xx on a bare GET**
(32 routes swept), and a live end-to-end run (create → step → complete → metrics → recommend →
reuse → hand-edit → DOCX → delete) passes, including deliberately corrupted JSON columns.

# Changelog

All notable changes to JOB-HUNTER. Newest first.

## 2026-10-30 — The resume arsenal, end to end

Tailoring no longer means starting from scratch for every posting.

- **Resumes tab** (`/resumes`) — every resume the app has produced, with its source job,
  size, keywords and reuse count, plus rename, delete, download and "use for…".
- **Recommendation on the job page** — the app checks the arsenal before you tailor: *reuse*,
  *light edit*, or *tailor fresh*, with the match score, the reason, and the terms the posting
  asks for that the resume does not cover. One click attaches an existing resume.
- **Reuse attaches a copy** to the job and increments the original's reuse count, so the
  existing detail page and DOCX export keep working unchanged and provenance is recorded.
- **`GET /api/resumes/[id]/docx`** exports any arsenal resume, not just the one attached to a job.
- **Schema**: `label`, `role_title`, `keywords`, `source_resume_id`, `reuse_count` on `resumes`
  (idempotent ALTERs), and the tailor route now records the label and the ATS keywords it
  wrote against, so new resumes land in the library ready to match.

**The bug that would have made it useless:** description tokens were marked supplementary
unconditionally, but every real posting repeats its own title in the body — so the title words
were excluded from the coverage denominator and the core signal collapsed to nothing. Every
job reported "too little text to match on" with a 2,000-character description. Fixed, with a
regression test.

**Verified:** `verify-resume-match.ts` 50/50 · `verify-arsenal.ts` 24/24 against the real DB
(self-cleaning) · `tsc` and ESLint clean · the Resumes tab render-checked in Brave with real
data. The job-page banner is verified at the API level (correct verdict, score and missing
terms) but not visually confirmed — the shared Brave had zero tabs by then and CDP-created
tabs get no renderer without a window.



- **`docs/decisions.md`** — why things are the way they are, with what was rejected. Covers
  the resume arsenal, the harness that destroyed the master resume, no-XP, the stage-event
  log, measure-relevance-not-yield, the tailnet binding, search levers, and profile-driven
  ranking. The README now points at it as required reading before changing those areas.
- **`src/lib/resumeMatch.ts`** + **`scripts/verify-resume-match.ts`** (48 checks) — the
  matching half of the arsenal: given a job, which resume you already have fits it, and does
  it warrant a fresh tailoring. Logic only; schema, API, library page and the job-page
  recommendation are not built yet.

**Bugs the harness caught while writing it** — all three were real, not test noise:
- `photographer` and `photography` were different tokens, so the single most important
  overlap was invisible and a video resume scored 0 against a video job. Craft terms are now
  canonicalised (`photo`, `video`, `edit`, `dj`, …) with a phrase pass for multi-word ones
  (`disc jockey`).
- The 3-character minimum was silently discarding **`dj`** — a core term for this searcher.
  Short signal terms now have an allowlist.
- Coverage was denominator-sensitive: a 2,000-character description added ~150 weight-1 tokens
  and swamped the title and keywords, so a same-vertical job stopped looking like a match.
  Description text is now supporting evidence with a capped bonus, never part of the ratio.
- A legacy markdown resume parsed to an empty fingerprint and was permanently unmatchable; it
  now falls back to its own raw text.

, measured for relevance not just volume

Asked what other keywords to search. Answered by measuring rather than guessing: 48
candidate terms drawn from the resume (LA MEDIA, Complete Weddings, Meet Week, Moran
Academy, Amazon, LA Fitness, Butterfield LLC), each scraped and classified by whether its
titles are actually this work.

**New tooling:** `scripts/measure-search-relevance.py` — scores a term by how many of its
returned titles are media/event production vs adjacent vs noise. Written because yield
alone gave bad advice.

**The finding that changed the presets:** the terms that sound most like the job return the
least (`event technician` 1, `stagehand` 1, `audio visual technician` 5, `media specialist`
7), while the work hides under generic stems — `video production` returned **14 listings,
all 14 on-target**. And the biggest numbers are usually noise: `merchandiser` 87 listings /
**0** relevant, `warehouse` 100/4, `live stream` 85/3, `event production` 100/9 (it matches
manufacturing "production").

**Presets rebuilt** around measured relevance: Photo/video (`video production`, `product
photography`, `real estate photography`), Events/AV (`event setup`, `audiovisual`,
`streaming`), and a new Media/content-roles set (`digital content`, `media production`,
`media specialist`, `content producer`, `creative services`, `communications specialist`).

**Vertical verdicts:** media/event production works on Indeed; fitness/strength mostly does
not (`weightlifting` 2 on-target of 100, `fitness coach` 1, `personal trainer` 0); DJ and
wedding remain **zero** — that work is not on job boards and needs vendor channels.

 + pipeline progress (no XP, no points)

Momentum layer, built to the shape asked for: **simple next steps you tick off**, and
**metrics over time for how far each listing got in the interview process**. No XP,
levels, streaks or badges — deliberately, because rewarding application *volume* trains
you to spam listings.

- **One next step per tracked job**, chosen from its status: Apply → Follow up (10-day
  window) → Send thank-you → Ask for timeline → Respond to offer. Terminal outcomes
  propose nothing, so a closed pipeline stops nagging. Tick it off and the next is
  proposed automatically; completing an **Apply** step also moves the job to `applied`
  and dates it, so nothing has to be entered twice.
- **`job_stage_events`, append-only.** `jobs.status` only holds the CURRENT status, so on
  its own it cannot answer "how far did I get" — a rejection after an onsite and a
  rejection the day after applying are the same value. Every transition is now logged
  **inside `updateJob`**, so every path that changes a status (UI, import, any future
  automation) produces the same history.
- **Metrics**: funnel with conversion rates over *applied* jobs (a saved listing you
  never applied to cannot fail to respond, so it must not dilute the rate), median days
  to first response, furthest-stage-reached distribution, and applications grouped by
  week. A rejected listing keeps its high-water mark and counts as having reached it.
- **Dashboard**: "Next steps" is now the first thing on the page, since it is the only
  part that asks you to do something; the progress panel sits beside the scrape stats.
- **`scripts/backfill-pipeline-history.ts`** seeds history and a first step for jobs
  tracked before this existed (idempotent, `--dry-run` supported).
- **Two new harnesses**: `verify-pipeline-metrics.ts` (62 checks, pure rules) and
  `verify-steps.ts` (38 checks against the real DB, self-cleaning).

Bugs caught while building it: a follow-up step reported a 10-day window as "in 9 days"
by measuring from a timestamp instead of from today; `daysBetween` accepted a null second
argument in the type but not in the signature; the new progress component shadowed the
existing `Progress` bar import; and the harness's `eq` compared arrays by reference.

 with reality, and the harness un-broken

- **`verify-pipeline.ts` hardcoded `localhost:3002`**, so once the app became a service
  bound to the Tailscale address it reported "cannot reach the server" against a perfectly
  healthy app. It now auto-detects the server (BASE → localhost → this machine's Tailscale
  address). Note it probes with `curl` rather than `fetch`: this repo's package.json has no
  `"type": "module"`, so tsx emits CJS and a top-level `await` is a build error.
- **README**: the "run it" section said port **3000**; it is 3002. Added a **Status** section
  stating plainly what is built and what is not — batch resume generation and browser
  auto-apply do not exist yet, and no search tuning reaches the wedding/DJ work because it is
  not posted on job boards.
- **`docs/scraper-improvements.md`**: added the measured search-yield table and the three
  findings behind it (Indeed ANDs phrases; `distance` must be sent explicitly; the DJ/wedding
  terms return zero because of the channel, not the query).
- **`SCRUM/Sprint_View.md`**: was an untouched TBD stub; now reflects the sprint's actual
  work, the backlog, and what is blocked and why.

## 2026-10-27 — Runs as a LaunchAgent on the mini, reachable over Tailscale

`http://alexs-mac-mini:3002` from any tailnet device. Agent
`ai.buttergang.job-hunter` runs `scripts/serve-tailnet.mjs`, `RunAtLoad` + `KeepAlive`
(verified by SIGKILL: launchd restarted it and it served again).

Bound to the **Tailscale address, not 0.0.0.0** — the macOS firewall is off on this
machine, so binding everything would expose an app with no auth on 25 of 27 routes to the
whole LAN. `localhost:3002` consequently does not answer on the mini.

Three gotchas found the hard way, all documented in the README:
- A launchd job cannot read the external SSD with `/bin/bash`: TCC refuses a removable
  volume to a "platform binary" and will not even prompt, so the script died at spawn with
  `Operation not permitted`. Exec'ing **node directly** works.
- `StandardOutPath` on the external volume kills the job at setup with `EX_CONFIG 78` and
  no output whatsoever.
- The Tailscale CLI does not work from a launchd agent: it prints "The Tailscale GUI failed
  to start" *to stdout*, which naively becomes a hostname (`ENOTFOUND`). Resolve the
  address via `ifconfig` and validate it against 100.64.0.0/10.

Also found: the `ai.buttergang.gas-daily` agent is **not loaded**, so it has never run and
its log does not exist.

## 2026-10-27 — Search yield: 3 listings → 225, and two features that never worked

The pipeline was finding almost nothing. The cause was the search, not the scraper: every one
of the four levers was at its most restrictive setting.

**Measured on Indeed, Indianapolis (unique listings):**

| lever | restrictive | permissive | effect |
|---|---|---|---|
| Term | `photographer` 3 | `photo` 53 | ~17x |
| Distance | 50mi 51 | 100mi 89 | +70% |
| Window | 7d 51 | 30d 100 | ~2x |
| Result cap | 25 | 200+ (pool goes deeper) | 8x |

End to end through the app: **3 unique → 225 unique**, 2.7s.

- **Distance is now a real control.** It was never sent by the app — the Python default of 50
  was silently always in force, on both the manual and the bulk scan forms. Validated 1-500,
  threaded through the runner and the bulk per-state calls, and recorded on `scrape_runs` so a
  past run can be reproduced.
- **Search presets built from measurements**, and the defaults changed from `software engineer
  @ Remote` to `photo` + `event staff` at 100mi / 30 days / 100 per site.
- **Short stems beat job titles**: Indeed ANDs the words, so "wedding photographer" returns 0
  where "photo" returns hundreds. The UI now says so where you type the terms.

**Two features that silently did nothing, now fixed:**

- **The dashboard's "rank all listings" button returned 401.** `/api/analysis/backfill` is
  called from the browser with no headers, and the route was wrapped in `withAuth`. Only 2 of
  27 routes were auth-gated and the UI cannot supply a credential for either, so the gate was a
  dead feature rather than a protection — 25 other routes, including the one that spends real
  money on scraping, are open. Both routes are now consistent with the rest of the app.
  (`/api/admin/import-bls`, the Settings BLS import, had the same problem.)
- **Batch ranking scored 0 of 228.** Every chunk of 40 hit the 16k output ceiling — our limit,
  not the provider's (the model allows 128k). Chunk size is now 20, the ceiling 32k, and a
  chunk the model cannot answer in one response is **halved and retried** instead of losing the
  whole run. Chunks also run 3-at-a-time: a 228-listing run went from ~15 minutes to ~7, with
  228/228 scored and 0 errors.

**Result of the fix** — the broad search surfaces listings the narrow terms never could. Top
scored: Photographer/Videographer at Firebelly Marketing ($35-50/hr), Wedding Videographer at
Danbren Media ($60-61/hr), Real Estate Media Specialist at Luxe Homes Media, Video Editor at
IMS Productions, Multimedia Producer at Indiana University, and an Event Associate opening at
The Mill Top. 24 listings scored interest >= 8.

## 2026-10-27 — BUTTERFIELD LLC added, contact details in, undated-role rendering fixed

- **BUTTERFIELD LLC** is now a real entry (`Founder & Software Developer`) rather than a
  placeholder: web applications and data pipelines, 80+ repositories (39 public), representative
  projects named, infrastructure work, LLM integration. Every claim is verifiable against the
  public GitHub account — no revenue or client figures were invented.
- **Dated `Aug 2026 – Present`.** The entity is roughly two months old, so the description says
  "the practice spans 80+ repositories" rather than implying every repository was built inside
  it — otherwise the dates and the numbers contradict each other. (An undated role previously
  rendered as `Present – Present`; that bug is fixed and it now renders `– Present` when no
  start year is known.)
- **Fixed an undated-role rendering bug**: a role whose only date value is "Present" produced
  `Present – Present` in the generated resume, because the model put the same token in both
  fields. The master file now instructs it to leave the start date blank, and the output reads
  `– Present`.
- **Contact details** (email, phone, portfolio) are now carried through; the master file's
  instruction changed from "these are omitted, do not invent them" to "use these exactly, invent
  nothing beyond them". Verified: all five contact fields come back populated and matching.
- Fidelity check extended to a **software-developer** job description, which confirms the LLC
  surfaces for software roles; contact values are now asserted to match rather than to be empty.

## 2026-10-27 — LinkedIn merged into the master resume; education added to the schema

The work history had no education, no certifications, no location, and was missing a role that
only exists on the LinkedIn profile.

- **Education was missing from the resume schema entirely** — `ResumeStructure`, the tailor
  prompt, the DOCX template and the job-detail preview all lacked it, so any education on the
  master resume was silently dropped from every generated resume. Added end to end and verified
  in the rendered DOCX (`EDUCATION`, school, credential and dates all present in the XML).
- **A current role was missing.** Moran Academy for Strength and Speed (Olympic Lifting Coach,
  2020-Present) is on LinkedIn but not in the spreadsheet, so the history looked like it stopped
  in 2020 outside of two roles. Added.
- **Dates and titles reconciled with LinkedIn** where it was more precise or more senior:
  Meet Week Co. is `Executive Producer, 2022-2025` (was "Event Coordinator & Media Specialist,
  2022-2024"), and Amazon is `2019-2020`. Locations per role added (the DOCX prints
  `title | company | location`, so an empty location left a dangling separator).
- **Certifications** added with issuer and stated dates. All three have passed expiry dates;
  the prompt is told to show them exactly as issued and never extend a date, and the master
  file says so explicitly.
- **Contact**: location (Carmel, Indiana) and the LinkedIn URL are now carried through.
  Email, phone and portfolio are deliberately absent with a "do not invent" instruction —
  generated resumes leave them empty instead of fabricating values.
- `import-master-resume.ts` now validates location presence and the no-invent instruction, and
  counts roles by the `## Company — Title` pattern so section headings aren't miscounted.
- Verified across two job descriptions: employers, dates, school and certifications all trace
  back to the master resume; Mill Top reads `2022-Present`; no invented contact value.

## 2026-10-27 — Real master resume in place, and the tooling to keep it there

The app had no master resume, so nothing could be tailored. The work history now lives in
`data/master_resume.md` (gitignored) and is loaded into `resumes` (type `master`), which is
what `getMasterResume()` and `/api/ai/tailor` read.

- `scripts/work-history-to-resume.py` converts the work-history spreadsheet into the flat
  master-resume text: every bullet, skill and achievement preserved, roles in reverse
  chronological order, plus a de-duplicated skills index. It also writes a CSV and an
  optionally corrected spreadsheet.
- **The Mill Top is `2022-Present`, not `2022`.** The sheet listed a single year for a role
  that is ongoing, which reads as ended experience to a ranker and to a human. Corrections
  live in a `CORRECTIONS` table in the converter so a re-import can't silently drop them.
- A `BUTTERFIELD LLC` row was added as a **TODO placeholder** — name, role and dates are facts
  only the owner can supply. TODO-bearing rows are excluded from the resume text (kept in the
  CSV/XLSX) so a stub can never be fed to the model as experience.
- Contact details are deliberately absent from the master file and the prompt is told not to
  invent them; the tailored output leaves those fields empty instead of fabricating an email.
- `scripts/import-master-resume.ts` validates before writing (minimum length, role headings,
  no TODOs, at least one ongoing role) and prints only a summary.
- Verified: a tailored wedding-videographer resume selects the four relevant roles (LA Media,
  COMPLETE Weddings + Events, Meet Week Co., The Mill Top), keeps Mill Top's end date as
  `Present`, invents no employer or date, and leaves contact empty. DOCX export from the real
  resume: 10.3 KB, valid container.

## 2026-10-27 — Pipeline verification pass: three real bugs, docs brought current

Added `scripts/verify-pipeline.ts` — 23 stages against a running server, asserting on real
responses and real database rows: LLM reachable → scrape (Python) → rank → cross-run dedupe →
persist → run detail → market analysis → import to tracker → tracked detail → listing recheck →
rate-limit isolation → resume JSON → resume persistence → DOCX export → dashboard →
paste-a-posting. It is idempotent (re-runnable against a populated database), writes a
placeholder master resume for the resume stages and deletes both that and any resume tailored
from it afterwards. **23/23 pass.**

Three bugs it found and this commit fixes:

- **The scraper was annualising pay and destroying the unit.** `scripts/scrape_jobs.py` passed
  `enforce_annual_salary=True`, so jobspy multiplied hourly rates by 2080 and relabelled the
  interval "yearly": a $60/hr per-event wedding videographer was stored as **$124,800/yr**
  (implying a year of full-time work) and a seasonal $14/hr gig as $29,120/yr. Now `False`,
  so the quoted rate and its unit survive (`$20–$30/hr` stays `$20–$30/hr`), and
  `src/lib/pay.ts` annualises using the posting's own stated hours when that is needed.
  The pay *source* is also carried into the prompt, so a figure the job board estimated is
  never read as a stated rate (and can never score `salaryConfidence: "high"`).
- **Every rate limiter shared one counter.** `rateLimitStore` was a single module-level Map
  keyed only by client id, so a request to any rate-limited route incremented the counter the
  AI limiter read: ~10 requests anywhere started returning 429 on AI routes, and one bulk-scan
  call (2 per 5 minutes) could lock out the entire API for five minutes. Each limiter now owns
  its store, entries are swept when they expire (the old map never pruned), and responses
  carry `X-RateLimit-Policy` naming the budget that was hit.
- **The scrape interpreter was hardcoded to `python3`** — the macOS system 3.9, which has no
  `jobspy`. The failure looked like "0 results" (i.e. a blocked board), not a missing module.
  New `src/lib/pythonBin.ts` resolves `SCRAPE_PYTHON_BIN` → the `python_bin` setting →
  `.venv/bin/python3` → `venv/bin/python3` → PATH, and when the interpreter can't import its
  dependencies the API says so with the exact fix instead of reporting an empty scrape.

Docs: README (Python setup incl. the `--copies` requirement, project structure, complete route
table, new DB columns, a "Verifying the pipeline" section, settings reference), and
`docs/scraper-improvements.md` (pay-unit traps, interpreter resolution, refreshed remaining
work). Two SCRUM backlog cards were re-scoped to reality — the "add Indeed/LinkedIn/Glassdoor"
card described scrapers that already ship, and its real gap is creative/event sourcing.

## 2026-10-27 — Earnings-aware weekly commitment rule, and a bug sweep

**The hours rule now weighs pay, not just the hour count.** 15h at $50/hr ($750/wk) is a
better deal than 20h at $15/hr ($300/wk), and the ranker previously could not express that:
any week under 20h took a flat penalty regardless of rate.

- `work.minWeeklyEarnings` (default $600/wk) joins `work.minWeeklyHours`. A role clears the
  bar by meeting **either** — so a short, well-paid week is accepted rather than fined.
- The penalty is now **graduated by how short the week actually is**: a near-miss costs a
  point or two, a badly short week costs the configured maximum, and a week that clears a
  floor or is justified costs nothing. Verified: 18h @ $28/hr (a $504/wk near-miss) costs 2
  points where 8h with no stated rate costs 7.
- A week that meets the hours minimum but pays poorly is **flagged, not fined**
  (`Meets the hours minimum but pays only $300/wk`), so the trade-off stays visible without
  silently overriding the stated hours rule.
- The prompt now states the trade-off explicitly and instructs the model to score the hours
  axis on hours *and* earnings — "a short week at a high rate belongs at 8-10, not at 5".
- Live check: 15h @ $50/hr scores 84 (`basis: earnings`, no penalty) against 20h @ $15/hr at
  63 (`basis: hours`, no penalty, flagged for low earnings).

**Bugs fixed**

- **`POST /api/scrape` ignored its own validation.** The result was assigned to
  `validatedConfig` and never read, so `ok: false` was never checked and the scrape ran on the
  raw request body instead of the sanitised values — `results: 99999` or an unknown site went
  straight through to the scraper. Now returns 400 with the reason.
- **`Authorization: Bearer <token>` was rejected.** `authMiddleware` read the header, never
  used it, and only accepted `x-auth-token` / `x-api-key` despite the comment claiming
  otherwise. Bearer is now accepted as an auth token.
- **Dead code removed:** unused `dupCount` counter in the market-analysis aggregation (the
  response already reports `duplicatesRemoved`), unused `total` parameter on `runAnalysis`,
  a stale local `scoreColor` helper and unused imports across `dashboard`, `page`, `auth`,
  `rateLimit`, `layout`. ESLint is now clean (was 15 warnings, 0 errors) and the production
  build passes.

## 2026-10-27 — OpenRouter support (no Anthropic key required)

Every AI feature now goes through one provider-agnostic layer instead of the Anthropic
SDK called directly with model ids baked into the call sites (one of which,
`claude-haiku-4-5-20251001`, is not a valid id anywhere).

- **New `src/lib/ai/llm.ts`** — `chatComplete()` / `testLlm()`. Provider, key and a
  per-role model (ranker / tailor / extract / ats) are resolved from settings, falling
  back to the environment (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`). Defaults to
  OpenRouter, supports Anthropic direct, and falls back to whichever provider actually
  has a key rather than failing every feature.
- **Verified model ids** against the live OpenRouter catalogue: ranking
  `anthropic/claude-haiku-5.5` (~$0.10/$0.50 per M tokens), tailoring
  `anthropic/claude-sonnet-5`. Both overridable in Settings.
- **Settings → AI Provider** card: provider picker, key fields (never echoed back),
  per-role model overrides with the effective value shown, and a **Send test request**
  button that makes one real completion and reports model, latency and any error.
  Replaces the old API Configuration card.
- `scripts/import-openrouter-key.ts` copies the key already on this machine
  (`~/.hermes/.env`) into the app's settings table, printing only a masked fingerprint.
- HTTP failures are translated into actionable messages (401 bad key, 402 out of credit,
  404 unknown model, 429 rate limited) instead of a generic 502.
- `json_object` response mode is requested where supported and retried once without it,
  since not every OpenRouter-backed model accepts it.

Two ranking bugs surfaced by the first live run and fixed:

- **Full-time was not an accepted engagement type.** The profile's engagement list
  covered contract/freelance/per-event/temporary/part-time but not W-2 full-time, so
  every full-time listing scored engagement ~2 and carried a "not in accepted types"
  flag — the profile was rejecting the market's most common engagement type.
  `work.acceptFullTime` added (default on).
- **Unknown hours were penalised like a confirmed short week.** A listing that did not
  state its schedule took the full under-minimum penalty, quietly burying most of the
  market. The penalty now applies only to a confirmed `hours:under-min` verdict; unknown
  hours are flagged and cost nothing. Score deductions are also persisted
  (`job_analysis.penalties`) and shown, so a score can be explained.

Live verification (`scripts/rank-probe.ts`) against the real listings for the target
vertical, through OpenRouter, all five real on-target listings above both off-profile
controls: Wedding Videographer 82, product-photo/e-comm 79, automotive photo/video 66,
library videographer 63, seasonal photo 61 — Software Engineer control 58, Warehouse
control 51.

## 2026-10-27 — Profile-driven ranking (replaces the hardcoded persona)

The ranker carried a job-seeker persona inside its prompt (no degree / wants remote /
wants Mon–Fri / Indianapolis suburbs). It was invisible in the UI, unchangeable
without editing source, and it structurally capped on-site, weekend and per-event
work. Two data bugs compounded it.

**The persona is gone; a profile replaces it**
- New `src/lib/profile.ts`: an editable `TargetProfile` (market, interests,
  willingness, compensation, requirements, per-axis weights, penalties, free-text
  notes). Persisted as JSON under the `target_profile` setting, deep-merged onto
  the defaults so a partial or malformed profile is always safe to load.
- New Settings → **Target Profile** card (`src/components/settings/target-profile.tsx`)
  with a guided editor plus a raw-JSON escape hatch. Weights show their normalised
  effective value.
- The ranking prompt is now rendered from the profile (`buildProfilePromptBlock`)
  and contains no assumptions of its own. Interests are a first-class axis, so
  relevance is scored rather than implied.
- **Nothing is filtered.** The prompt explicitly forbids scoring a listing down for
  being off-interest, off-industry, part-time, on-site, contract, weekend-heavy or
  missing details, and requires every listing to be scored. Concerns are returned as
  advisory `flags`.

**Pay units are preserved end to end**
- `scripts/scrape_jobs.py` no longer discards jobspy's `interval` column. An hourly
  rate used to reach the ranker labelled "/year" — every hourly or per-event posting
  scored as sub-poverty pay. New columns: `salary_interval`, `salary_source`,
  `is_remote`, `job_level`, `listing_type`, `company_industry`, `experience_range`.
- New `src/lib/pay.ts`: unit-aware normalisation (hourly/daily/weekly/biweekly/
  monthly/yearly/per-event), interval inference for legacy rows, unit-bearing labels,
  and prompt text that never annualises a per-event rate silently.

**The weekly-hours rule (≥20h)**
- New `src/lib/match.ts`: `evaluateHoursRule` — a week below the profile minimum is
  excused when the role is remote or genuinely self-scheduled, and penalised
  otherwise. The verdict, its reason and its penalty are stored and shown.
- The weighted rank score is now computed in code from the profile weights, not
  requested from the model: an axis can no longer be scored and then silently left
  out of the total, and reweighting is a config change rather than a prompt rewrite.
- `scoreResponsibilities` is finally part of the aggregation; new `score_interest`
  and `score_engagement` axes, plus `pay_interval`, `pay_label`, `hours_verdict`
  and `flags` are persisted on `job_analysis`.

**Descriptions are used**
- `analysisRunner` no longer stubs `description: null` (its comment claimed the column
  did not exist — it does, and is populated). Mass ranking now scores the posting text,
  not just its title.

**Verification**
- `scripts/verify-ranking.ts` (`node_modules/.bin/tsx scripts/verify-ranking.ts`) runs
  offline with no API key: unit normalisation, the hours rule, weight normalisation,
  penalty visibility, prompt assertions (no persona strings, real pay units) and profile
  round-trips. It caught two real bugs during development — the hours floor read off the
  wrong object, and a duplicate `requirements` key that collided the accessibility axis
  with the structured requirements object.
- Applied to the real listings the scraper returns for the target vertical, the
  on-target wedding-videographer role now outranks the software-engineer control
  (80 vs 71); under the previous formula it lost (74 vs 84).

## 2026-10-23 — Security: dependency vulnerability fixes

Known advisories (OSV) in lockfiles: **8 critical, 63 high, 70 moderate, 16 low → 1 moderate**.

- **Next.js 16.2.9 → 16.4.2** (`next`, `eslint-config-next`, pinned) — fixes critical unauthenticated RCE advisories
- Non-breaking `npm audit fix` updates; production dependencies audit clean
- `pnpm-lock.yaml` had drifted from `package-lock.json` (still resolving vulnerable versions); regenerated from it with `pnpm import`
- Critical/high advisories cleared in: `dompurify`, `next`, `proxy-addr`, `@modelcontextprotocol/sdk`, `body-parser`, `brace-expansion`, `browserslist`, `fast-uri`, `ip-address`, `js-yaml`, `nanoid`, `postcss`, `sharp`, `source-map-js`, `undici`, `zod`
- Verified: `npm run build` passes
