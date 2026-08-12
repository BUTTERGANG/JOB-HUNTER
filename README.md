# Job Hunter

A personal job-hunting dashboard that scrapes listings from multiple job boards, ranks them with AI, benchmarks salaries against BLS wage data, and sends Discord alerts when high-scoring jobs appear.

## Features

- **Multi-board scraping** — LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google via `python-jobspy`
- **All-states Bulk Market Scan** — Sweep all 50 states + DC with per-site result caps, automatic retry/backoff, and a live ETA
- **Residential proxy support** — Route scrapes through rotating proxies (e.g. DataImpulse) to avoid single-IP rate limiting; per-site status (`ok` / `blocked` / counts) surfaced in the UI
- **AI ranking** — Each job is scored across pay, flexibility, location, requirements, hours, and workload using Anthropic Claude
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
- **Listing availability detection** — Recheck a tracked job's original posting (per-job or bulk) to flag it `active` / `expired` / `unknown`; every check is logged to history for long-term trend analysis

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **UI:** React, Tailwind CSS, shadcn/ui components
- **Database:** SQLite (via `better-sqlite3`)
- **AI:** Anthropic Claude API (`@anthropic-ai/sdk`)
- **Scraping:** `python-jobspy` (Python subprocess)
- **Tables:** `react-table` / shadcn Table
- **Charts:** `recharts`
- **CSV parsing:** `papaparse`
- **Notifications:** Discord webhooks (native `fetch`)

## Prerequisites

- Node.js 18+
- Python 3.10+ with `python-jobspy` installed (`pip install python-jobspy`)
- An Anthropic API key

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/BUTTERGANG/JOB-HUNTER.git
cd JOB-HUNTER/job-hunt-app
npm install
```

### 2. Set up Python scraping dependency

```bash
pip install python-jobspy
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Configure

Go to **Settings** and add:
1. Your **Anthropic API key**
2. Your **master resume** text
3. **Salary targets** (minimum, target, stretch)
4. **Scheduled scrape** searches, sites, and frequency
5. (Optional) **Scrape proxies** + session-pool size — strongly recommended before running the all-states Bulk Market Scan (see below)

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
│   ├── components/              # Shared UI (sidebar, etc.)
│   └── lib/
│       ├── ai/                  # Claude prompt engineering
│       ├── db/                  # SQLite schema, queries, migrations
│       ├── notifications/       # Discord embed formatting
│       ├── scrapeRunner.ts      # Orchestrates scrape → analyze → save (proxy expansion, per-site status)
│       ├── resumeTemplate.ts    # Builds a .docx from the structured tailored-resume JSON
│       ├── jobIdentity.ts       # URL/text normalization & dedupe keys
│       └── socSectors.ts        # SOC major group → sector name mapping
├── scripts/
│   └── scrape_jobs.py           # Python jobspy wrapper
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
| `/api/jobs` | GET | List tracked jobs |
| `/api/jobs` | POST | Create a tracked job (with duplicate check) |
| `/api/jobs/import` | POST | Bulk import from scrape results |
| `/api/jobs/[id]` | GET/PATCH/DELETE | Job CRUD |
| `/api/jobs/[id]/analysis` | POST | Re-analyze a job |
| `/api/ai/tailor` | POST | Generate a tailored resume (structured JSON) from the master resume + JD |
| `/api/jobs/[id]/resume` | GET/PUT | Read / save the stored tailored resume for a job |
| `/api/jobs/[id]/resume/docx` | GET | Download the tailored resume as a `.docx` file |
| `/api/settings` | GET/PUT | Read/write settings |
| `/api/notifications/discord/test` | POST | Send a test Discord message |
| `/api/analysis/market` | GET | Aggregated market analysis data (deduped by URL) |
| `/api/jobs/[id]/check-listing` | POST | Recheck one job's original posting for availability, log the result to history |
| `/api/jobs/check-listings` | POST | Recheck every tracked job with a URL (all-time, not just recent scrapes) |

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

### How it works
1. **Generate** — `POST /api/ai/tailor` sends your master resume + the JD (and any ATS
   keywords/must-haves already extracted by the JD analysis) to Claude, which returns a
   **structured JSON** resume: `name`, `tagline`, `contact`, `professionalSummary`,
   `coreCompetencies` (technical/operations/leadership), `professionalExperience[]`,
   `technicalProficiencies`, `certifications`. The model is instructed to use only facts from
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
- **`scrape_runs`** / **`scrape_results`** — Each scrape session and its individual listings
- **`job_analysis`** — AI scores per scrape result (rank + per-dimension + extracted details)
- **`resumes`** — Master resume (`type: "master"`) and per-job tailored resumes (`type: "tailored"`, one row per generation, latest wins)
- **`settings`** — Key/value configuration (API keys, schedule, Discord, salary targets, proxies)
- **`bls_wages`** — BLS OEWS national wage data keyed by SOC occupation code (`occ_code`); populated on demand for salary benchmarking
- **`listing_status_history`** — Append-only log of every listing-availability check (job id, status, timestamp); `jobs.listing_status`/`listing_checked_at` hold only the latest snapshot

The database is auto-created on first run. No migrations needed — the schema uses `CREATE TABLE IF NOT EXISTS`.

## Environment Variables

None required. All configuration is stored in the database via the Settings UI. Secrets — the Anthropic API key, Discord webhook URL, and **scrape proxy credentials** (`scrape_proxies`, with pool size `scrape_proxy_sessions`) — are saved to the `settings` table in the gitignored `data/` DB and are never returned in plaintext by the settings API.

## Scripts

- `npm run dev` — Start dev server with Turbopack
- `npm run build` — Production build
- `npm run start` — Run production build
- `npm run lint` — ESLint

## License

MIT
