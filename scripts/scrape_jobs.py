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
    frames = []
    for site in config["sites"]:
        print(f"  [{site}] {search['term']} @ {search['location']}", file=sys.stderr, flush=True)
        try:
            kwargs = dict(
                site_name=[site],
                search_term=search["term"],
                location=search["location"],
                results_wanted=config.get("results", 25),
                hours_old=config.get("hours", 168),
                country_indeed=config.get("country", "USA"),
                enforce_annual_salary=True,
            )
            if site == "linkedin":
                kwargs["linkedin_fetch_description"] = True
            is_remote = config.get("is_remote")
            if isinstance(is_remote, bool):
                kwargs["is_remote"] = is_remote
            df = scrape_jobs(**kwargs)
            print(f"    → {len(df)} results", file=sys.stderr, flush=True)
            if not df.empty:
                frames.append(df)
        except Exception as e:
            print(f"    ✗ {site} failed: {e}", file=sys.stderr, flush=True)

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
