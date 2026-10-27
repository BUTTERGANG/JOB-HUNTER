# Changelog

All notable changes to JOB-HUNTER. Newest first.

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
