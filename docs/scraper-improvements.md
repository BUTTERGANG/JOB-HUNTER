# Scraper — Working Notes

Status doc for the job scraper, especially the **all-states Bulk Market Scan**.
Last updated **2026-06-19**.

## Architecture recap

The scrape flow spans these layers:

1. **UI** — `src/app/scrape/page.tsx`
   - `BulkMarketScan` runs the all-states scan: a sequential loop over `US_STATES`
     (51 incl. DC), one `POST /api/scrape` per state, with per-state retry, jittered
     inter-state pacing, and a live elapsed/ETA readout.
   - `NewScrape` runs single ad-hoc scrapes.
2. **API route** — `src/app/api/scrape/route.ts`
   - Thin wrapper; picks a server timeout tier and calls `runScrapeAndAnalyze`.
   - Passes through `resultsBySite` and returns `siteStatus` for diagnostics.
3. **Runner** — `src/lib/scrapeRunner.ts`
   - Writes a temp JSON config, shells out to Python via `execFile`, reads the output
     CSV, dedupes, saves to DB, optionally runs AI analysis.
   - Captures Python stderr → `parseSiteStatus()` → per-site `siteStatus[]`.
   - Expands proxies into a rotation pool via `expandProxies()`.
4. **Scraper** — `scripts/scrape_jobs.py`
   - Wraps `python-jobspy`. Loops over sites per search; supports per-site result caps
     (`results_by_site`) and a `proxies` list.

There is also a standalone copy at repo root `scrape_jobs.py` (not used by the app).

## JobSpy limits (verified from source — `pip show -f python-jobspy`)

- **Indeed** — fast, no built-in delay, mobile GraphQL API, pages 100 at a time, natural
  cap ~1000/search. README claims "no rate limiting" but it degrades under sustained
  single-IP load. → push it hard.
- **LinkedIn** — hardcoded `time.sleep(3–7s)` **per page** (`delay=3 band_delay=4`), 25/page,
  hard cap `start<1000`. Rate-limits ~10 pages per IP. **This is the runtime bottleneck.**
  → keep its result cap low and rely on proxy rotation.
- **Google** — has internal 429 retry (`has_retry=True`); Indeed/LinkedIn do not.
- **`user_agent` param is IGNORED by all sites** (hardcoded header constants; Indeed uses
  its iOS-app UA on purpose). UA rotation is a deliberate non-goal — patching it would risk
  *more* detection, not less.
- **Proxy round-robin is built in** (`util.py` `RotatingProxySession`, `itertools.cycle`):
  passing a *list* of proxy strings rotates per request.
- **No 1000-cap config and no "140 cap"** exists — low bulk counts were single-IP throttling,
  not a configured limit.

## Implemented

### 2026-06-18 — all-states timeout fixes
- Client abort raised to 320s (just above the 300s server cap).
- `bulkMode` flag → server uses the 300s timeout tier for per-state calls; `maxDuration = 300`.
- Bulk default volume lowered; wasted LinkedIn description fetches removed in bulk mode
  (`fetch_descriptions: !skipAnalysis`).

### 2026-06-19 — diagnostics, proxies, max coverage
- **Per-site stderr capture + `siteStatus`.** `scrapeRunner.ts` captures Python stderr
  (16 MB `maxBuffer`); `parseSiteStatus()` returns per-site `{results, failures, errors,
  blocked}`, surfaced through `route.ts` into the bulk error list (e.g. `indeed: 23,
  linkedin: blocked`). Turns silent zero-job states into diagnosable ones.
- **Proxy support.** Setting `scrape_proxies` (newline-separated, masked secret — never
  echoed by `GET /api/settings`). Applies to manual, scheduled, and bulk scrapes.
- **DataImpulse session pool.** `expandProxies(lines, sessions, runId)` fans a DataImpulse
  credential into N sticky sessions (`;sessid.<runId>_<n>;sessttl.10` after the username);
  JobSpy round-robins across them. Setting `scrape_proxy_sessions` (default 8). Non-DataImpulse
  proxies pass through unchanged. Fresh `runId` per state/retry → fresh IPs.
- **Per-site result caps.** Bulk UI has a result input per selected site (defaults
  Indeed 300 / LinkedIn 75 / Google 100, max 1000). Config `resultsBySite` → py
  `results_by_site` (falls back to the shared `results`).
- **Per-state retry with backoff.** Blocked/empty/failed states re-run up to 3× with
  exponential backoff (~5s, ~15s + jitter). Partial blocks (some sites returned jobs) log a
  warning instead of re-fetching the good sites. Jittered 6–12s inter-state delay retained.
- **Live ETA.** Bulk progress shows elapsed time and a rolling ETA
  (`avg-per-completed-state × states-remaining`).

## Remaining proposed improvements

### 1. Incremental CSV write — LOW effort, HIGH value
`scrape_jobs.py` writes the CSV once at the end of `main()`. If the `execFile` timeout fires,
Python is SIGKILLed before `to_csv()` → no output file → the state reports 0 even if some
sites already succeeded. Fix: append to the CSV after each site/search so partial progress
survives a kill. Files: `scripts/scrape_jobs.py`.

### 5. Server-side bulk run — HIGH effort
The whole ~40–60 min scan lives in the browser tab; closing it / sleep kills the run and the
ETA timer. Move the bulk scan to a background server job with a job id, persisted progress,
and a status endpoint the UI polls (reconnects on reload). This is the home for retry logic
too. Files: new API route(s), DB schema for job/progress, `page.tsx` rework to poll.

## Settings reference (scraper-related)

| Key | Meaning |
|---|---|
| `scrape_proxies` | Newline-separated proxy list (`user:pass@host:port`). Masked secret. |
| `scrape_proxy_sessions` | Int (default 8). DataImpulse sticky sessions to fan a credential into. |
| `scrape_dedupe_enabled` | `"true"`/`"false"` — skip jobs seen in previous runs (off in bulk via `skipDedupe`). |

## Coverage / anti-block knobs

- **Per-site results** (bulk UI): Indeed 300 / LinkedIn 75 / Google 100, up to 1000/site.
- **`scrape_proxy_sessions`**: ~8 balanced; bump to ~15 for max stealth.
- **Inter-state delay**: `BULK_STATE_DELAY_MS` / `_JITTER_MS` in `page.tsx` (6–12s).
- **Retry**: `BULK_MAX_ATTEMPTS` / `BULK_RETRY_BASE_MS` / `BULK_RETRY_JITTER_MS` in `page.tsx`.

## Cost (DataImpulse @ $1/GB)
A full 50-state scan ≈ 15–35 MB ≈ ~$0.02–0.04 (Indeed descriptions are the main driver).
Daily use ≈ $1–2/month. Measure real usage on the DataImpulse dashboard after the first run.

## Quick test notes
- Standalone scraper: `cd job-hunt-app && python3 scripts/scrape_jobs.py`
  (writes to `scraped/jobs_<timestamp>.csv`). Needs `pip install -U python-jobspy`.
- Test a single state through the proxy: write a temp config with `proxies`, `sites`, and
  `results_by_site`, then `python3 scripts/scrape_jobs.py --config <cfg> --out <csv>`.
- Confirm a US proxy exit before a real run (DataImpulse MCP `proxy_check`, or any IP echo
  service through the proxy).
- Verify no proxy creds land in git: `git grep -nI dataimpulse` should only match the
  detection regex in `scrapeRunner.ts`.
