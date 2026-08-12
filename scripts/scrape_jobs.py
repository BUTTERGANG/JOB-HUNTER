#!/usr/bin/env python3
"""
JobSpy scraper — collects job listings into a CSV.

Standalone:  python3 scripts/scrape_jobs.py
Via API:     python3 scripts/scrape_jobs.py --config /tmp/cfg.json --out /tmp/out.csv
Install:     pip install -U python-jobspy
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
    from jobspy import scrape_jobs
except ImportError:
    print(
        "ERROR: python-jobspy not installed. Run: pip install -U python-jobspy",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Default config (used when running standalone without --config) ──────────

DEFAULT_CONFIG = {
    "searches": [
        {"term": "software engineer", "location": "San Francisco, CA"},
        {"term": "software engineer", "location": "Remote"},
        {"term": "backend engineer", "location": "New York, NY"},
        {"term": "staff engineer", "location": "Remote"},
    ],
    "sites": ["linkedin", "indeed", "glassdoor", "zip_recruiter"],
    "results": 25,
    "hours": 168,
    "is_remote": None,
    "country": "USA",
}

# ── Core ────────────────────────────────────────────────────────────────────


def run_search(search: dict, config: dict) -> "pd.DataFrame":
    # Proxies (optional). JobSpy round-robins through the list per site, which is
    # the documented fix for LinkedIn's ~10-pages-per-IP block and Indeed's
    # single-IP degradation. Format: "user:pass@host:port", "host:port", or "localhost".
    proxies = config.get("proxies") or None
    # Per-site result caps let us push fast sites (Indeed) hard while keeping slow
    # ones (LinkedIn, ~3-7s/page) modest. Falls back to the shared "results" value.
    results_by_site = config.get("results_by_site") or {}
    sites = config["sites"]

    def scrape_one(site):
        """Scrape a single site. Returns (DataFrame|None, list[str] log lines).
        Lines are returned (not printed) so the caller can emit each site's lines
        contiguously — keeping stderr parseable despite concurrent execution."""
        lines = [f"  [{site}] {search['term']} @ {search['location']}"]
        try:
            kwargs = dict(
                site_name=[site],
                search_term=search["term"],
                location=search["location"],
                results_wanted=results_by_site.get(site) or config.get("results", 25),
                hours_old=config.get("hours", 168),
                country_indeed=config.get("country", "USA"),
                enforce_annual_salary=True,
                distance=config.get("distance", 50),
            )
            # google_search_term override — used when search_term is empty so
            # Google doesn't get a " jobs near {loc}" query (leading space, no
            # keyword → 0 results). See scrapeRunner.ts for the trigger logic.
            google_search_term = config.get("google_search_term")
            if google_search_term:
                kwargs["google_search_term"] = google_search_term
            if proxies:
                kwargs["proxies"] = proxies
            if site == "linkedin" and config.get("fetch_descriptions", True):
                kwargs["linkedin_fetch_description"] = True
            is_remote = config.get("is_remote")
            if isinstance(is_remote, bool):
                kwargs["is_remote"] = is_remote
            df = scrape_jobs(**kwargs)
            lines.append(f"    → {len(df)} results")
            return (df if not df.empty else None, lines)
        except Exception as e:
            lines.append(f"    ✗ {site} failed: {e}")
            return (None, lines)

    # Scrape sites concurrently so LinkedIn's per-page sleep overlaps the fast
    # sites instead of stacking after them. Each scrape_jobs() call is independent
    # (fresh scraper instances), so this is thread-safe.
    frames = []
    with ThreadPoolExecutor(max_workers=max(1, len(sites))) as ex:
        futures = [ex.submit(scrape_one, s) for s in sites]
        for fut in as_completed(futures):
            df, lines = fut.result()
            # Emit this site's lines together (marker then result) so the
            # line-based stderr parser attributes counts to the right site.
            for ln in lines:
                print(ln, file=sys.stderr, flush=True)
            if df is not None:
                frames.append(df)

    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def safe_col(df: "pd.DataFrame", name: str) -> "pd.Series":
    if name in df.columns:
        return df[name]
    return pd.Series([""] * len(df), dtype=str)


def build_output(df: "pd.DataFrame") -> "pd.DataFrame":
    def to_salary_int(series: "pd.Series") -> "pd.Series":
        return series.apply(lambda x: int(x) if pd.notna(x) and x != "" else "")

    desc = safe_col(df, "description")
    if hasattr(desc, "str"):
        desc_short = desc.str.slice(0, 2000).str.replace("\n", " ", regex=False).fillna("")
    else:
        desc_short = desc

    out = pd.DataFrame(
        {
            "Title": safe_col(df, "title"),
            "Company": safe_col(df, "company"),
            "Location": safe_col(df, "location"),
            "Date Posted": safe_col(df, "date_posted"),
            "Source": safe_col(df, "site"),
            "Job URL": safe_col(df, "job_url"),
            "Salary Min": to_salary_int(safe_col(df, "min_amount")),
            "Salary Max": to_salary_int(safe_col(df, "max_amount")),
            "Job Type": safe_col(df, "job_type"),
            "Description": desc_short,
        }
    )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape job listings via JobSpy")
    parser.add_argument("--config", help="Path to JSON config file")
    parser.add_argument("--out", help="Output CSV path (overrides default scraped/ dir)")
    args = parser.parse_args()

    if args.config:
        with open(args.config) as f:
            config = json.load(f)
    else:
        config = DEFAULT_CONFIG

    frames = [run_search(s, config) for s in config["searches"]]
    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    if "job_url" in combined.columns:
        combined = combined.drop_duplicates(subset="job_url", keep="first")

    print(f"Total unique listings: {len(combined)}", file=sys.stderr, flush=True)

    output = build_output(combined)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = Path("scraped")
        out_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M")
        out_path = out_dir / f"jobs_{timestamp}.csv"

    output.to_csv(out_path, index=False)
    print(f"Saved → {out_path}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
