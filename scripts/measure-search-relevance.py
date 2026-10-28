"""Measure search RELEVANCE, not just yield.

A term returning 100 listings is worthless if 2 of them are the kind of work you do.
This scrapes each term and classifies the returned titles, so a keyword can be judged on
"how many of these would I actually want" rather than on raw volume.

  .venv/bin/python3 scripts/measure-search-relevance.py
  .venv/bin/python3 scripts/measure-search-relevance.py --terms "media specialist" "live event"

Writes data/search-relevance.json. Read-only: nothing is stored in the app's database.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from jobspy import scrape_jobs

OUT = Path("data/search-relevance.json")

# CORE: the work is media/event production — the verticals actually being targeted.
CORE_RE = re.compile(
    r"photo|video|film|camera|media|content|creative|production|editor|event|"
    r"wedding|dj|disc jockey|\bav\b|audio|stream|broadcast|stage|studio|lighting",
    re.I,
)
# ADJACENT: transferable, but a different job than the one being searched for.
ADJACENT_RE = re.compile(
    r"marketing|communications|social|fitness|coach|trainer|athletic|sports|"
    r"warehouse|logistics|inventory|merchandis",
    re.I,
)

# Terms worth judging. The zeros and the capped-at-100s from the yield sweep are the ones
# that need a relevance answer: a term at 100 could be gold or could be all noise.
DEFAULT_TERMS = [
    "digital content", "creative services", "media production", "event production",
    "live event", "event setup", "banquet", "catering", "entertainment",
    "merchandiser", "social media", "live stream", "product photography",
    "communications specialist", "audiovisual", "streaming", "brand ambassador",
    "post production", "marketing coordinator", "e-commerce", "resale", "av",
    "video production", "multimedia specialist", "media specialist", "creative director",
    "real estate photography", "content producer", "event technician", "stagehand",
    "warehouse", "electronics technician",
]

PACE_SECONDS = 3.0
LOCATION = "Indianapolis, IN"
DISTANCE = 100
HOURS = 720


def classify(term: str) -> dict:
    started = time.time()
    try:
        df = scrape_jobs(
            site_name=["indeed"],
            search_term=term,
            location=LOCATION,
            results_wanted=100,
            hours_old=HOURS,
            country_indeed="USA",
            distance=DISTANCE,
            enforce_annual_salary=False,
            verbose=0,
        )
    except Exception as e:  # noqa: BLE001
        return {"term": term, "error": f"{type(e).__name__}: {e}", "rows": 0, "core": 0,
                "adjacent": 0, "other": 0, "core_pct": 0, "core_examples": []}

    titles: list[str] = []
    if df is not None and len(df):
        for _, row in df.iterrows():
            title = str(row.get("title") or "").strip()
            if title:
                titles.append(title)

    core, adjacent, other = [], [], []
    for title in titles:
        if CORE_RE.search(title):
            core.append(title)
        elif ADJACENT_RE.search(title):
            adjacent.append(title)
        else:
            other.append(title)

    total = max(1, len(titles))
    return {
        "term": term,
        "error": None,
        "rows": len(titles),
        "core": len(core),
        "adjacent": len(adjacent),
        "other": len(other),
        "core_pct": round(100 * len(core) / total),
        "core_examples": core[:4],
        "seconds": round(time.time() - started, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--terms", nargs="*", default=None)
    args = ap.parse_args()

    terms = args.terms or DEFAULT_TERMS
    results: list[dict] = []
    if OUT.exists():
        results = json.loads(OUT.read_text())

    for term in terms:
        if any(r["term"] == term for r in results):
            continue
        r = classify(term)
        results.append(r)
        flag = f"  ERROR {r['error']}" if r.get("error") else ""
        print(
            f"{r['term']:26} rows={r['rows']:<4} core={r['core']:<4} ({r['core_pct']:>3}%) "
            f"adj={r['adjacent']:<4}{flag}",
            flush=True,
        )
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(results, indent=1))
        time.sleep(PACE_SECONDS)

    print("\n=== most relevant first (core = media/event production titles) ===")
    print(f"{'term':26} {'rows':>5} {'core':>5} {'core%':>6} {'adj':>5}  examples")
    for r in sorted(results, key=lambda x: (-x["core_pct"], -x["core"])):
        ex = "; ".join(t[:34] for t in r["core_examples"][:2])
        print(f"{r['term']:26} {r['rows']:>5} {r['core']:>5} {r['core_pct']:>5}% {r['adjacent']:>5}  {ex}")


if __name__ == "__main__":
    main()
