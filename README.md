# Job Hunter

A personal job-hunting dashboard that scrapes listings from multiple job boards, ranks them with AI, benchmarks salaries against BLS wage data, and sends Discord alerts when high-scoring jobs appear.

## Features

- **Multi-board scraping** — LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google via `python-jobspy`
- **AI ranking** — Each job is scored across pay, flexibility, location, requirements, hours, and workload using Anthropic Claude
- **BLS wage benchmarks** — Indiana salary data from the Bureau of Labor Statistics for comparison
- **Job tracking pipeline** — Import scraped jobs into a tracker with status, tier, notes, and resume tailoring
- **Scheduled scraping** — Configure recurring scrapes that run automatically
- **Discord notifications** — Get alerted in a Discord channel when scheduled scrapes find jobs above your score threshold
- **Cross-run deduplication** — Same listing won't be analyzed or alerted on twice
- **Import duplicate protection** — Can't accidentally add the same job to tracking twice
- **Market Analysis dashboard** — Visual breakdown of all scraped jobs: sectors, salary distribution, remote vs onsite, top companies, posting timeline, and more
- **Salary targeting** — Set minimum/target/stretch salaries; benchmark against BLS data
- **Master resume** — Store your resume once; use it when tailoring applications

## Tech Stack

- **Framework:** Next.js 15+ (App Router)
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

## Project Structure

```
job-hunt-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ai/              # AI analysis & resume tailoring
│   │   │   ├── jobs/            # CRUD + import endpoints
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
│       ├── scrapeRunner.py      # Orchestrates scrape → analyze → save
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
| `/api/jobs/[id]/resume` | POST | Generate tailored resume bullets |
| `/api/settings` | GET/PUT | Read/write settings |
| `/api/notifications/discord/test` | POST | Send a test Discord message |
| `/api/analysis/market` | GET | Aggregated market analysis data (deduped by URL) |

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

## Job Identity & Duplicate Detection

Jobs are identified by:
1. **URL** (normalized: lowercase host, no query/hash, no trailing slash) — preferred
2. **Text** (`company|role|location` — all lowercased and trimmed) — fallback

This identity system is shared across scrape dedupe, import protection, and UI selection keys.

## Database

SQLite stored at `data/jobhunt.db`. Two main tables:

- **`jobs`** — Tracked jobs with status, tier, salary, scores, notes, etc.
- **`scrape_results`** — Individual listings from each scrape run
- **`settings`** — Key/value configuration (API keys, schedule, Discord, salary targets)
- **`bls_wages`** — BLS Ohio wage data by SOC code

The database is auto-created on first run. No migrations needed — the schema uses `CREATE TABLE IF NOT EXISTS`.

## Environment Variables

None required. All configuration is stored in the database via the Settings UI. The Anthropic API key and Discord webhook URL are saved to the `settings` table.

## Scripts

- `npm run dev` — Start dev server with Turbopack
- `npm run build` — Production build
- `npm run start` — Run production build
- `npm run lint` — ESLint

## License

MIT
