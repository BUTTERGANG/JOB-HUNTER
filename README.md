# Job Hunter

A personal job-hunting dashboard that scrapes listings from multiple job boards, ranks them with AI, benchmarks salaries against BLS wage data, and sends Discord alerts when high-scoring jobs appear.

## Features

- **Multi-board scraping** — LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google via `python-jobspy`
- **All-states Bulk Market Scan** — Sweep all 50 states + DC with per-site result caps, automatic retry/backoff, and a live ETA
- **Residential proxy support** — Route scrapes through rotating proxies (e.g. DataImpulse) to avoid single-IP rate limiting; per-site status (`ok` / `blocked` / counts) surfaced in the UI
- **AI ranking from your target profile** — Each job is scored by the configured model (OpenRouter or Anthropic) across pay, interest, responsibility, hours, flexibility, location, accessibility and engagement type. Every weight, interest and rule lives in an editable **Target Profile**, not in the prompt
- **Unit-aware pay** — Hourly, daily, per-event and annual rates are kept distinct end to end; an hourly rate is never read as an annual salary
- **Earnings-aware commitment rule** — A role clears the bar by meeting either your weekly-hours minimum (default 20h) or your weekly-earnings floor (default $600). A short week at a high rate is accepted, not fined; a genuine shortfall loses points graduated by how short it is. Always ranked and shown, never hidden
- **BLS wage benchmarks** — National OEWS wage data (by SOC occupation code) from the Bureau of Labor Statistics for salary comparison
- **Job tracking pipeline** — Import scraped jobs into a tracker with status, tier, notes, and resume tailoring
- **Scheduled scraping** — Configure recurring scrapes that run automatically
- **Discord notifications** — Get alerted in a Discord channel when scheduled scrapes find jobs above your score threshold
- **Cross-run deduplication** — Same listing won't be analyzed or alerted on twice
- **Import duplicate protection** — Can't accidentally add the same job to tracking twice
- **Market Analysis dashboard** — Visual breakdown of all scraped jobs: sectors, salary distribution, remote vs onsite, top companies, posting timeline, and more
- **Salary targeting** — Set minimum/target/stretch salaries; benchmark against BLS data
- **Master resume** — Store your resume once; use it when tailoring applications
- **AI resume tailoring** — Generate a job-specific resume from your master resume + the JD (structured JSON), preview it, hand-edit it, and export to Word (`.docx`)
- **Next steps, not a to-do list** — every tracked job carries exactly one actionable step, chosen from its status (Apply → Follow up → Send thank-you → Ask for timeline → Respond to offer). Tick it off and the next one is proposed automatically. Completing an "Apply" step also advances the job to applied and dates it, so the metrics below need no extra bookkeeping
- **Progress you can measure** — every status change is appended to a stage history, so "how far did I get" survives a rejection: a rejection after an onsite still counts as having reached the onsite. The dashboard shows the funnel (applied → responded → interview → offer) with conversion rates, median days to first response, the furthest-stage-reached distribution, and applications grouped by the week they went out
- **Listing availability detection** — Recheck a tracked job's original posting (per-job or bulk) to flag it `active` / `expired` / `unknown`; every check is logged to history for long-term trend analysis

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **UI:** React, Tailwind CSS, shadcn/ui components
- **Database:** SQLite (via `better-sqlite3`)
- **AI:** OpenRouter (default) or Anthropic direct, via one provider-agnostic layer (`src/lib/ai/llm.ts`)
- **Scraping:** `python-jobspy` (Python subprocess)
- **Tables:** `react-table` / shadcn Table
- **Charts:** `recharts`
- **CSV parsing:** `papaparse`
- **Notifications:** Discord webhooks (native `fetch`)

## Prerequisites

- Node.js 18+
- Python 3.10+ with `python-jobspy` — create a project virtualenv and the app picks it up
  automatically (see below)
- An LLM API key — OpenRouter (recommended) or Anthropic direct

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/BUTTERGANG/JOB-HUNTER.git
cd JOB-HUNTER/job-hunt-app
npm install
```

### 2. Set up Python scraping dependency

```bash
python3 -m venv --copies .venv
.venv/bin/pip install python-jobspy
```

`--copies` matters: a default venv symlinks `bin/python` to an interpreter outside the project,
and Turbopack panics on that during `next build`. If you'd rather keep the venv elsewhere,
point `python_bin` (or `SCRAPE_PYTHON_BIN`) at it instead.

The app resolves the scraper's interpreter in this order: `SCRAPE_PYTHON_BIN` →
the `python_bin` setting → `.venv/bin/python3` → `venv/bin/python3` → `python3` on PATH.

Do **not** skip this and rely on `python3` being right: on macOS that is the system 3.9
interpreter with no `jobspy`, and the failure surfaces as "0 results" rather than a missing
module — it looks like the job board blocked you. If the interpreter can't import its
dependencies the API now says so explicitly instead.

For the WorkForIndiana government scraper, also install Playwright:
`.venv/bin/pip install playwright && .venv/bin/playwright install chromium`

### 3. Run it

```bash
npm run dev          # development, http://localhost:3002
```

On the mini it runs as a service instead — see
[Running it as a service](#running-it-as-a-service-on-a-home-server-tailscale).

### 4. Configure

Go to **Settings** and add:
1. Your **AI provider key** (Settings → AI Provider; OpenRouter is the default)
2. Your **Target Profile** (interests, market, willingness, weekly-hours minimum, per-axis weights) — see below
3. Your **master resume** text
4. **Salary targets** (minimum, target, stretch)
5. **Scheduled scrape** searches, sites, and frequency
6. (Optional) **Scrape proxies** + session-pool size — strongly recommended before running the all-states Bulk Market Scan (see below)

## Status

Built and verified end to end (scrape → rank → persist → track → tailor → export):

| capability | state |
|---|---|
| Multi-board scrape (jobspy: Indeed, LinkedIn, Google, ZipRecruiter, Glassdoor) | working; search settings measured and tuned |
| AI ranking from the Target Profile | working; 228 listings scored in ~7 min, 0 errors |
| Unit-aware pay + earnings-aware commitment rule | working; asserted offline by `verify-ranking.ts` |
| Job tracking, market analysis, BLS wage benchmarks | working |
| Resume: master + per-job tailoring + `.docx` export | working — **one job at a time, from the job page** |
| Scheduled scrapes + Discord alerts | working |
| Runs as a LaunchAgent on the mini, reachable over Tailscale | working |

**Not built yet** — the gap between "a dashboard that finds and ranks jobs" and "identify
jobs and generate resumes automatically":

1. **Batch resume generation.** Tailoring works, but only one job at a time from
   `/jobs/[id]`. Nothing walks the ranked list and produces resumes for the top N.
2. **Auto-apply.** No browser automation exists. The intended approach is driving the
   persistent Brave over CDP, reusing a single tab.
3. **Vendor channels.** `dj`, `wedding dj` and `event photographer` return **zero** listings
   on Indeed — that work is not posted on job boards at all. Thumbtack / GigSalad / The Knot
   sourcing is where the wedding and live-event work lives, and none of it is implemented.

## Target Profile

**Settings → Target Profile** is the single place that describes what a good job looks
like. It replaced the job-seeker persona that used to be hardcoded inside the ranking
prompt, so nothing about the seeker lives in source code.

The profile holds:

- **Interests** — the relevance signal (matched against titles, companies and descriptions)
- **Industries** — leave blank for "not picky"
- **Weekly hours and earnings** — your minimum hours (default 20h) and the weekly earnings
  floor (default $600). A role clears the bar by meeting either, so 15h at $50/hr ($750/wk)
  is accepted where 15h at $15/hr ($225/wk) is not. A week that misses both, with no remote
  or scheduling flexibility, loses points graduated by how short it is
- **Compensation** — optional hourly/annual floor, target and stretch. Left blank, rates are
  scored against what the work pays in the market instead of pass/fail
- **Work you will take** — on-site, remote, hybrid, weekends, evenings, holidays, contract,
  freelance, per-event, temporary, part-time
- **Market** — city, state, cost-of-living index, commute tolerance, out-of-state scope
- **About you** — degree (or unset), experience, gear you own, certifications, portfolio
- **What matters most** — per-axis weights. Shown with their normalised effective value; the
  total always scales to 0–100 regardless of what the raw numbers add up to
- **Widen the search** — on by default: roles outside your stated interests are still scored
  and shown when their pay, responsibility or growth looks good
- **Extra instructions** — free text passed to the ranker verbatim

Stored as JSON under the `target_profile` setting, so the raw form is editable too. A partial
or malformed profile deep-merges onto the defaults and never breaks ranking.

**Nothing in the profile is a filter.** Listings that miss a preference stay in the list and
are flagged (`under minimum weekly hours`, `outside stated interests`, `requires own camera`, …).

### How ranking works

The model returns per-axis scores (0–10) plus structured facts; the app computes the weighted
total, the weekly-hours verdict and any penalty in code (`src/lib/match.ts`). That means an axis
can't be scored and then silently dropped from the total, and reweighting is a config change
rather than a prompt rewrite.

Verify the whole ranking layer offline, no API key needed:

```bash
node_modules/.bin/tsx scripts/verify-ranking.ts
```

## Project Structure

```
job-hunt-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ai/              # AI analysis (analyze) & resume tailoring (tailor)
│   │   │   ├── jobs/            # CRUD + import + per-job resume (GET/PUT) & resume/docx export
│   │   │   ├── notifications/   # Discord webhook test
│   │   │   ├── scrape/          # Manual + scheduled scraping
│   │   │   ├── scrapes/         # Scrape run history
│   │   │   └── settings/        # App settings (key/value)
│   │   ├── jobs/                # Job tracking, compare, detail pages
│   │   ├── scrape/              # Scraping UI (new + history)
│   │   ├── analysis/            # Market Analysis dashboard
│   │   └── settings/            # Settings page
│   ├── components/
│   │   ├── layout/              # Sidebar / nav
│   │   ├── settings/            # Target-profile editor, AI-provider card
│   │   └── ui/                  # shadcn primitives
│   └── lib/
│       ├── ai/
│       │   ├── llm.ts           # Provider-agnostic LLM access (OpenRouter / Anthropic)
│       │   ├── analyzeJobs.ts   # Batch ranker: prompt build + result normalisation
│       │   └── extractJobFromUrl.ts  # Structured extraction from a posting page
│       ├── db/                  # SQLite schema (ddl), queries, idempotent migrations
│       ├── notifications/       # Discord embed formatting
│       ├── profile.ts           # Target profile: defaults, weights, prompt block
│       ├── match.ts             # Commitment rule + weighted aggregation + flags
│       ├── pay.ts               # Unit-aware pay normalisation (hr/day/wk/yr/per-event)
│       ├── pythonBin.ts         # Resolves + validates the scraper's Python interpreter
│       ├── scrapeRunner.ts      # Orchestrates scrape → analyze → save (proxies, per-site status)
│       ├── analysisRunner.ts    # Batch ranking runs over unanalyzed listings
│       ├── resumeTemplate.ts    # Builds a .docx from the structured tailored-resume JSON
│       ├── jobIdentity.ts       # URL/text normalization & dedupe keys
│       └── socSectors.ts        # SOC major group → sector name mapping
├── scripts/
│   ├── scrape_jobs.py           # Python jobspy wrapper (keeps the quoted pay unit)
│   ├── scrape_indiana.py        # Playwright scraper for WorkForIndiana
│   ├── import-openrouter-key.ts # Import a key from the environment into settings
│   ├── import-master-resume.ts  # Load a master resume file into settings (validated)
│   ├── work-history-to-resume.py # Spreadsheet work history → master resume text
│   ├── verify-ranking.ts        # Offline ranking checks (no API key needed)
│   ├── verify-pipeline.ts       # End-to-end pipeline verification against a running app
│   └── rank-probe.ts            # Live ranking probe over real scraped listings
└── data/                        # SQLite database (gitignored)
```

## Key API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/scrape` | POST | Run a manual scrape |
| `/api/scrape/scheduled` | GET | Get schedule config |
| `/api/scrape/scheduled` | POST | Run scheduled scrape (with Discord alerts) |
| `/api/scrapes` | GET | List scrape run history |
| `/api/scrapes/[id]` | GET | Get scrape run detail + results |
| `/api/scrapes/[id]` | DELETE | Delete a scrape run |
| `/api/scrape/bulk` | POST | All-states bulk market scan (server-side) |
| `/api/analyze-url` | POST | Extract + rank from a posting URL or pasted text |
| `/api/analysis/backfill` | GET/POST | Batch-ranking run status / start / cancel |
| `/api/jobs` | GET | List tracked jobs |
| `/api/jobs` | POST | Create a tracked job (with duplicate check) |
| `/api/jobs/import` | POST | Bulk import from scrape results |
| `/api/jobs/[id]` | GET/PATCH/DELETE | Job CRUD |
| `/api/jobs/[id]/analysis` | POST | Re-analyze a job |
| `/api/jobs/[id]/fetch-description` | POST | Fetch + extract a tracked job's posting text |
| `/api/government-postings/scrape` | POST | Scrape WorkForIndiana state postings |
| `/api/admin/import-bls` | GET/POST | BLS OEWS wage data status / import |
| `/api/ai/tailor` | POST | Generate a tailored resume (structured JSON) from the master resume + JD |
| `/api/ai/test` | POST | Check the configured LLM provider/model with one tiny completion |
| `/api/jobs/[id]/resume` | GET/PUT | Read / save the stored tailored resume for a job |
| `/api/jobs/[id]/resume/docx` | GET | Download the tailored resume as a `.docx` file |
| `/api/settings` | GET/PUT | Read/write settings |
| `/api/notifications/discord/test` | POST | Send a test Discord message |
| `/api/analysis/market` | GET | Aggregated market analysis data (deduped by URL) |
| `/api/jobs/[id]/check-listing` | POST | Recheck one job's original posting for availability, log the result to history |
| `/api/jobs/check-listings` | POST | Recheck every tracked job with a URL (all-time, not just recent scrapes) |

## Running it as a service on a home server (Tailscale)

The dashboard runs as a LaunchAgent on the Mac mini and is reached over the tailnet from
any of your other devices — no VNC needed for the page itself:

```
http://alexs-mac-mini:3002        # MagicDNS, from any tailnet device
http://100.118.244.119:3002       # the same thing by address
```

```bash
launchctl print   gui/$(id -u)/ai.buttergang.job-hunter   # status
launchctl kickstart -k gui/$(id -u)/ai.buttergang.job-hunter   # restart
launchctl bootout gui/$(id -u)/ai.buttergang.job-hunter   # stop (KeepAlive won't fight you)
tail -f ~/Library/Logs/job-hunter.log                    # logs
```

Agent: `~/Library/LaunchAgents/ai.buttergang.job-hunter.plist`, running
`scripts/serve-tailnet.mjs` (production; `SERVE_MODE=dev` in the plist's environment for
hot reload). `RunAtLoad` + `KeepAlive` mean it starts at login and restarts if it dies.

**It binds to the Tailscale address, not `0.0.0.0`.** The macOS firewall is off on this
machine, so `0.0.0.0` would put an app with no authentication on 25 of 27 routes in front
of every device on the local network. The tailnet is the access-control layer instead.
Consequence: `http://localhost:3002` does **not** answer on the mini — use either address
above, which work from the mini too. Set `BIND_HOST=0.0.0.0` if you ever want every
interface, and enable the firewall if you do.

### Three things that will bite you

1. **A launchd job cannot read an external SSD without a grant — and `/bin/bash` will
   never get one.** macOS TCC refuses a removable volume to a "platform binary" and does
   not even prompt for one, so a bash script on `/Volumes/...` dies at spawn with
   `Operation not permitted`. Running **node directly** (`serve-tailnet.mjs`) is what makes
   this work: node is not a platform binary and is eligible for the grant. Keep the
   program's interpreter out of `bash`.
2. **`StandardOutPath` must not be on the external volume.** launchd creates those files
   itself before running the program; on the SSD the job dies at setup with `EX_CONFIG 78`
   and produces no output at all — which looks like "the job does nothing". Logs go to
   `~/Library/Logs/`.
3. **The Tailscale CLI is unusable from a launchd agent.** It tries to launch the GUI app
   and prints its failure *to stdout*: `"The Tailscale GUI failed to start: ..."`. Taken at
   face value that becomes a hostname and `next start` dies with `ENOTFOUND`. Resolve the
   tailnet address with `ifconfig` and validate that it is a `100.64.0.0/10` address.

Also: the service needs the SSD mounted. If it is ejected, `data/` (the database, and every
setting including the API key) is gone and the app will start with an empty config.

## Searching: how to get listings out of Indeed

The search itself was the biggest constraint on the pipeline — the app shipped the most
restrictive setting on all four levers, and got **3 listings** for this market. Measured on
Indeed, Indianapolis, by unique listings:

| lever | restrictive | permissive | effect |
|---|---|---|---|
| **Term** | `photographer` → 3 | `photo` → 53 | **~17x** |
| **Distance** | 50 mi → 51 | 100 mi → 89 | **+70%** |
| **Window** | 7 days → 51 | 30 days → 100 | **~2x** |
| **Result cap** | 25 | 200 (the pool goes deeper) | **8x** |

Together: **3 unique listings → 225**, in 2.7 seconds.

### Two rules that matter more than anything else here

1. **Use short stems, not job titles.** Indeed ANDs every word, so `"wedding photographer"`
   returns **0** while `"photo"` returns hundreds. The same trap in reverse: `"photographer"`
   (3) is far narrower than `"photo"` (53). `"dj"`, `"wedding dj"` and `"event photographer"`
   all return **zero** — not because the search is wrong, but because that work is not posted
   on Indeed at all.
2. **Search broad, then rank.** Broad terms bring ~17% on-target titles plus noise. That is the
   design: the ranker's interest axis sorts them, and it costs about 3 cents to score 225
   listings. Narrowing the search instead of the ranking throws away the good listings with the
   bad ones.

The Scrape page ships presets built from these measurements (Photo/video, Events/weddings,
Creative/studio, Software), defaulting to `photo` + `event staff` at 100 mi / 30 days / 100 per
site. **Distance** is now a real control (it was silently fixed at 50) and every run records the
radius it used, so a past run can be reproduced.

## Verifying

Three offline harnesses and one live one. All of them assert on real rows and real
responses rather than on the code's intent.

```bash
# Pipeline progression rules — stage ordering, "furthest reached", next-step choice,
# conversion rates, UTC timestamp handling. No DB, no network.
node_modules/.bin/tsx scripts/verify-pipeline-metrics.ts

# Next steps + stage history against the real database. Creates a marked test job,
# drives it through the pipeline, then deletes it (the cascade cleans up).
node_modules/.bin/tsx scripts/verify-steps.ts

# Ranking rules — units, the commitment rule, weight normalisation, profile round-trips.
node_modules/.bin/tsx scripts/verify-ranking.ts
```

`scripts/backfill-pipeline-history.ts` seeds a stage event and a first next step for jobs
tracked before this feature existed. It is idempotent and safe to run against a live
database (`--dry-run` to preview).

## Verifying the pipeline

Three scripts, in increasing order of what they need:

```bash
# 1. Offline ranking logic — no API key, no network. Units, the commitment rule,
#    weight normalisation, penalty visibility, profile round-trips, and that no
#    persona text survives in the prompt.
node_modules/.bin/tsx scripts/verify-ranking.ts

# 2. Live ranking — runs the real ranker through the configured provider against the
#    real scraped listings plus off-profile controls, and prints axes, pay unit,
#    hours verdict, flags, penalties and notes.
node_modules/.bin/tsx scripts/rank-probe.ts

# 3. Whole pipeline against a running dev server — scrape (Python) → rank → persist →
#    market analysis → import to tracker → listing recheck → resume JSON → DOCX →
#    dashboard → paste-a-posting. Prints PASS/FAIL per stage.
node_modules/.bin/tsx scripts/verify-pipeline.ts
```

`verify-pipeline.ts` writes a **placeholder** master resume for the resume stages and removes
it at the end, so it never masquerades as the real one.

## Discord Notifications

1. In Discord, open a channel's **Integrations → Webhooks** and create a webhook
2. Paste the webhook URL into **Settings → Discord Notifications**
3. Set the **minimum score** threshold (default: 70) and **max jobs per alert** (default: 10)
4. Enable **"Skip jobs already seen"** deduplication to avoid repeat alerts
5. Click **Send Test** to verify the connection
6. Only **scheduled** scrapes trigger alerts — manual scrapes won't spam your channel

### Notification format

Each Discord alert includes:
- Total jobs found and how many met the threshold
- Top jobs (up to max) with: score, company, title (linked), location, salary, source
- A count of additional matches if there are more than the max

## Market Analysis Dashboard

Navigate to **/analysis** (or click **Market Analysis** in the sidebar) to see a visual breakdown of all scraped job data across every scrape run.

### Data Aggregation & Deduplication

The `/api/analysis/market` endpoint:
1. Pulls every `scrape_result` + its `job_analysis` across all scrape runs
2. **Deduplicates by normalized job URL** — if the same listing appears in multiple runs, only the most recent analysis is kept
3. Buckets and aggregates the unique set into charts

Filter controls at the top of the page let you narrow by **source**, **minimum score**, and **date range**.

### Dashboard Tabs

- **Overview** — Summary cards (total unique jobs, avg score, avg salary, % remote) + pie charts for job sectors (SOC groups), job types, degree requirements, and remote vs onsite
- **Salary** — Salary distribution bar chart, salary by sector comparison, remote vs onsite salary
- **Demand** — Top companies hiring, job board source breakdown, experience requirements, location breakdown
- **Timeline** — Weekly posting volume line chart + cumulative unique listings over time

### SOC Sector Mapping

Jobs are classified by SOC code (from AI analysis) into 23 major groups (e.g. `15-` → "Computer & Mathematical", `11-` → "Management"). Unclassified or missing SOC codes appear under "Other / Unclassified".

## Scrape Deduplication

When enabled (default: on), the scraper:
1. Removes duplicate listings within the same scrape run
2. Skips listings that appeared in previous scrape runs
3. Reports counts: `inputCount`, `withinRunDuplicates`, `previousRunDuplicates`, `outputCount`

## Bulk Market Scan & Proxies

The **all-states Bulk Market Scan** (on the Scrape page) sweeps all 50 states + DC, one
request per state, and is designed to pull as many listings as practical without getting
rate-limited.

### Per-site result caps
Each site has its own result cap (defaults **Indeed 300 / LinkedIn 75 / Google 100**, up to
1000). This is intentional: Indeed is fast and returns the most, while LinkedIn hardcodes a
3–7s delay *per page* and is the runtime bottleneck — so it gets a lower cap.

### Proxies (recommended for the full scan)
Running 51 states from one IP gets blocked fast (LinkedIn rate-limits ~10 pages per IP).
Add residential proxies in **Settings → Scrape proxies** (one per line,
`user:pass@host:port`). JobSpy round-robins through them per request.

For **DataImpulse** specifically, set **Proxy session pool size** (default 8): the single
credential is fanned out into that many rotating sticky residential sessions so requests are
spread across stable IPs. US targeting uses the `__cr.us` login suffix
(`USER__cr.us:PASS@gw.dataimpulse.com:823`). At ~$1/GB a full scan costs roughly $0.02–0.04.

Proxy strings are stored in the (gitignored) SQLite DB and **never echoed back** by the
settings API — only a masked summary and count are returned.

### Resilience & progress
- **Retry with backoff** — blocked/empty/failed states are re-run up to 3× from fresh proxy
  IPs (exponential backoff + jitter); partial blocks are logged as warnings, not retried.
- **Per-site status** — the progress/error list shows what each site did per state
  (`indeed: 280, linkedin: blocked`), parsed from the scraper's stderr.
- **Live ETA** — elapsed time and a rolling estimate are shown while scanning.
- The scan runs in the **browser tab** — keep it open until done (a background server run is
  a planned improvement; see `docs/scraper-improvements.md`).

## Job Identity & Duplicate Detection

Jobs are identified by:
1. **URL** (normalized: lowercase host, no query/hash, no trailing slash) — preferred
2. **Text** (`company|role|location` — all lowercased and trimmed) — fallback

This identity system is shared across scrape dedupe, import protection, and UI selection keys.

## Resume Tailoring

On a job's detail page (`/jobs/[id]`), the **Resume Tailor** tab generates a resume tailored
to that specific posting from your **master resume** (set in Settings) plus the job
description.

### Getting your history in

The master resume is the single source of truth: the tailor reorders and rephrases what is
there and is forbidden from inventing anything, so anything missing from it is missing from
every generated resume.

The converter merges **two sources**: the work-history spreadsheet (detail per role) and the
LinkedIn profile (dates, public-facing titles, education, certifications, and roles the
spreadsheet never had — a current role that exists only on LinkedIn was missing entirely).
LinkedIn facts live in a `LINKEDIN` block in the script; conflicts are resolved in
`CORRECTIONS`/`LOCATIONS` rather than by hand-editing the output.

If your history lives in a spreadsheet (`Year | Company | Position/Title | Responsibilities |
Skills Gained | Key Achievements/Metrics | Relevant For`), convert it:

```bash
.venv/bin/python3 scripts/work-history-to-resume.py \
    --in ~/Downloads/Alex_Butterfield_Work_History_Master.xlsx \
    --out-xlsx ~/Downloads/Alex_Butterfield_Work_History_Master_corrected.xlsx

node_modules/.bin/tsx scripts/import-master-resume.ts data/master_resume.md
```

- Outputs `data/master_resume.md` + `data/work_history.csv` (both gitignored — **never commit
  resume content to this public repo**) and optionally a corrected spreadsheet.
- Corrections that would otherwise be lost on a re-import (an ongoing role marked with a single
  year, for example) live in `CORRECTIONS` at the top of the script.
- Rows containing `TODO` are **excluded from the resume text** but kept in the CSV/XLSX, so a
  half-finished entry can't reach a generated resume as if it were experience.
- Education and certifications are emitted as their own sections. Certifications keep their
  issuer and stated dates and are **never** silently renewed — an expired certification is
  shown as expired, or dropped, not extended.
- Contact details (email, phone, location, LinkedIn, portfolio) are carried through and the
  master file instructs the model to use them verbatim and invent nothing beyond them. If a
  value is genuinely unknown it is left out with an explicit instruction rather than guessed.
- A role with no recorded start year is emitted as `– Present` with an instruction to leave the
  start date blank; it never renders as `Present – Present`.
- `import-master-resume.ts` refuses to import a resume that is suspiciously short, has no role
  headings, contains `TODO`, or has no ongoing role marked `Present`.
- The import prints a summary only — the resume text never passes through a shell, an HTTP
  body, or a log.

### How it works
1. **Generate** — `POST /api/ai/tailor` sends your master resume + the JD (and any ATS
   keywords/must-haves already extracted by the JD analysis) to Claude, which returns a
   **structured JSON** resume: `name`, `tagline`, `contact`, `professionalSummary`,
   `coreCompetencies` (technical/operations/leadership), `professionalExperience[]`,
   `technicalProficiencies`, `education[]`, `certifications`. Education was missing from the
   schema, so any education on the master resume was silently dropped from every generated
   resume — it now renders in the preview, the DOCX and the PDF path. The model is instructed to use only facts from
   your master resume — it reorders and rephrases, it does not invent.
2. **Store** — the JSON is saved to the `resumes` table (`type: "tailored"`, one row per
   generation, latest wins). `GET /api/jobs/[id]/resume` returns it; `PUT` saves hand-edits.
3. **Preview / Edit** — the tab has two sub-tabs: **Preview** renders the structured resume on
   a white "paper" sheet; **Edit** shows the raw JSON in a textarea for manual tweaks (Save
   persists them via `PUT`).
4. **Export** — **Download DOCX** (`GET /api/jobs/[id]/resume/docx`) builds a Word document
   from the JSON via the `docx` library and the template in `src/lib/resumeTemplate.ts`.

### Format notes
- **Structured JSON is the current format.** Older resumes may exist as **legacy markdown**
  (a plain string). The UI auto-detects which it is: legacy renders via `react-markdown` and
  offers **Export PDF** (client-side `html2pdf`) instead of DOCX. DOCX export requires the
  structured JSON format — re-generate a legacy resume to enable it.
- Generation uses `max_tokens: 8192` and rejects a response that hits the token ceiling
  (truncated JSON), so a broken/half resume is never saved. Code-fence-wrapped output
  (```` ```json ````) is stripped before parsing.
- The preview sheet is intentionally white with pinned dark text (`bg-white text-neutral-900`)
  so it stays readable in the app's **dark theme** and matches the exported document.

## Listing Availability Detection

Tracked jobs can be rechecked against their original posting URL to see if the
listing is still live.

- **Per-job** — the **Recheck** action on a job's detail/row fetches the
  posting page and classifies it `active`, `expired`, or `unknown` (e.g. blocked,
  network error, ambiguous page content). An **Expired** badge appears inline
  in the jobs table.
- **Bulk** — `/api/jobs/check-listings` runs the same check across **every**
  tracked job with a URL, regardless of when it was scraped — so all-time data
  gets refreshed, not just recent scrapes.
- **History** — every check (per-job or bulk) is appended to
  `listing_status_history`, independent of `jobs.listing_status` /
  `listing_checked_at`, which only ever hold the *latest* snapshot. Nothing is
  overwritten, so the full check history is preserved for trend analysis (e.g.
  how long listings from a given source stay open).

## Database

SQLite stored at `data/jobhunt.db`. Main tables:

- **`jobs`** — Tracked jobs with status, tier, salary, scores, notes, etc.
- **`scrape_runs`** / **`scrape_results`** — Each scrape session and its individual listings.
  Listings carry `salary_interval` (the pay unit — never dropped), `salary_source`
  (`direct_data` vs an `estimated` figure), `is_remote`, `job_level`, `listing_type`,
  `company_industry` and `experience_range`
- **`job_analysis`** — AI scores per scrape result: the weighted `rank_score`, the per-axis
  scores (pay, interest, responsibility, hours, flexibility, location, accessibility,
  engagement), `pay_interval`/`pay_label`, the `hours_verdict`, advisory `flags`, the
  `penalties` that were applied, plus extracted details and salary estimates
- **`resumes`** — Master resume (`type: "master"`) and per-job tailored resumes (`type: "tailored"`, one row per generation, latest wins)
- **`settings`** — Key/value configuration (API keys, schedule, Discord, salary targets, proxies)
- **`bls_wages`** — BLS OEWS national wage data keyed by SOC occupation code (`occ_code`); populated on demand for salary benchmarking
- **`listing_status_history`** — Append-only log of every listing-availability check (job id, status, timestamp); `jobs.listing_status`/`listing_checked_at` hold only the latest snapshot

The database is auto-created on first run. No migrations needed — the schema uses `CREATE TABLE IF NOT EXISTS`.

## AI Provider

All AI features — listing ranking, resume tailoring, posting extraction and ATS analysis —
go through `src/lib/ai/llm.ts`. **Settings → AI Provider** configures:

- **Provider** — OpenRouter (default) or Anthropic direct. If the chosen provider has no
  key, the other is used automatically instead of failing every feature.
- **Keys** — stored in the (gitignored) SQLite `settings` table and never returned by the
  API. `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` in the environment also work, so a key
  already on the machine needs no pasting.
- **Model per role** — ranking, tailoring, extraction, ATS. Defaults: ranking
  `anthropic/claude-haiku-5.5` (cheap, runs over the most tokens), tailoring
  `anthropic/claude-sonnet-5`.
- **Send test request** — one real completion to confirm the key and model work, reporting
  the model, latency and any error.

To reuse an OpenRouter key already on this machine without pasting it anywhere:

```bash
node_modules/.bin/tsx scripts/import-openrouter-key.ts          # reads $OPENROUTER_API_KEY or ~/.hermes/.env
node_modules/.bin/tsx scripts/import-openrouter-key.ts --dry-run
```

## Environment Variables

None required. All configuration is stored in the database via the Settings UI. Secrets — the
LLM provider keys (`openrouter_api_key` / `anthropic_api_key`), the Discord webhook URL, and
**scrape proxy credentials** (`scrape_proxies`, with pool size `scrape_proxy_sessions`) — are
saved to the `settings` table in the gitignored `data/` DB and are never returned in plaintext
by the settings API. `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` in the environment are used as a
fallback when no key is stored, and `SCRAPE_PYTHON_BIN` overrides the scraper's interpreter.

## Scripts

- `npm run dev` — Start dev server with Turbopack
- `npm run build` — Production build
- `npm run start` — Run production build
- `npm run lint` — ESLint

## License

MIT
