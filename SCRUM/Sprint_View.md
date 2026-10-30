# Sprint View -- JOB-HUNTER

> **Sprint:** 2026-10-27 → 2026-10-28
> **Sprint Name:** Search yield + service deployment
> **Goal:** Get more than 5 listings out of the search, rank them all, and get the
> dashboard running as a service on the mini.

---

## Done This Sprint

| Task | Completed |
|------|-----------|
| Search yield: measure all four levers and fix them (3 → 225 unique listings) | 2026-10-27 |
| Distance control threaded through validation, UI, runner, bulk scan, and `scrape_runs` | 2026-10-27 |
| Search presets + measured defaults on the Scrape page | 2026-10-27 |
| Fix two dead features: rank-all button (401) and BLS import (401) | 2026-10-27 |
| Batch ranking: ceiling 16k → 32k, chunk 40 → 20, split-and-retry on truncation | 2026-10-27 |
| Bounded chunk concurrency (3): 228 listings ~15 min → ~7 min, 228/228 scored | 2026-10-27 |
| LaunchAgent service over Tailscale (`ai.buttergang.job-hunter`) | 2026-10-27 |
| Docs: README search + service + status sections, CHANGELOG, scraper-improvements | 2026-10-28 |
| Fix `verify-pipeline.ts` to find the service (it hardcoded `localhost:3002`) | 2026-10-28 |

## Done (2026-10-30)

| Task | Completed |
|------|-----------|
| Resume arsenal: library tab, recommendation (reuse / adapt / tailor), reuse with provenance | 2026-10-30 |
| Matching logic + 50-check harness; three real bugs caught (craft terms, `dj` dropped, description swamping) | 2026-10-30 |
| Keyword expansion measured for relevance, not volume; presets rebuilt | 2026-10-30 |
| Silent-error audit: 7 classes fixed, incl. migrations that swallowed every failure | 2026-10-30 |
| Security: assessment in `docs/security.md`, SSRF closed, DB `0600`, `npm audit` clean | 2026-10-30 |
| Harnesses grown to nine, including fresh-database and SSRF guards | 2026-10-30 |

---

## In Progress

| Task | Agent | Priority | Est. |
|------|-------|----------|------|
| —    | —     | —        | —    |

---

## Done (2026-10-28)

| Task | Completed |
|------|-----------|
| Next steps: one actionable step per tracked job, ticked off, auto-proposed from status | 2026-10-28 |
| Stage history (`job_stage_events`), logged inside `updateJob` so no path can skip it | 2026-10-28 |
| Progress metrics: funnel + rates, median days to first response, furthest reached, weekly cohorts | 2026-10-28 |
| Dashboard panels (Next steps first, then progress); per-job steps API | 2026-10-28 |
| Backfill for jobs tracked before the feature | 2026-10-28 |
| Harnesses: `verify-pipeline-metrics.ts` 62 checks, `verify-steps.ts` 38 checks | 2026-10-28 |
| UI verified rendering in Brave (8 checks, tab closed after) | 2026-10-28 |

---

## Sprint Backlog

| Task File | Priority | Estimate | Status |
|-----------|----------|----------|--------|
| Batch resume generation for the top-ranked listings | P1 | L | not started |
| Browser auto-apply over CDP (single reused tab) | P1 | L | not started |
| `SCRUM/Backlog/additional_job_board_scrapers.md` | P1 | L | backlog |
| `SCRUM/Backlog/application_tracking_and_status_board.md` | P2 | M | backlog |

---

## Blocked

| Task | Blocked Since | Reason |
|------|---------------|--------|
| Vendor channels (Thumbtack / GigSalad / The Knot) | 2026-10-27 | Not built. Indeed returns **zero** for `dj`, `wedding dj`, `event photographer` — the wedding and live-event work is not posted on job boards, so no amount of search tuning reaches it. |
