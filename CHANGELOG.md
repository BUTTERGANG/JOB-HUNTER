# Changelog

All notable changes to JOB-HUNTER. Newest first.

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
