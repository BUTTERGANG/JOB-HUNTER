# Changelog

All notable changes to JOB-HUNTER. Newest first.

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
