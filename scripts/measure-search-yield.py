"""Measure search yield: which terms, locations, radii and windows actually return listings.

Run with the app's own venv so the jobspy version matches production. Writes every run to
JSON so partial progress survives, and prints a summary table.

  .venv/bin/python3 scripts/measure-search-yield.py --phase terms
  .venv/bin/python3 scripts/measure-search-yield.py --phase geo
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from jobspy import scrape_jobs

OUT = Path("data/search-yield.json")

# Terms worth testing: the ones we used, plus how a human actually names these jobs.
TERMS = [
    "photographer",
    "videographer",
    "video editor",
    "wedding photographer",
    "wedding videographer",
    "wedding dj",
    "dj",
    "event photographer",
    "event staff",
    "content creator",
    "photo editor",
    "production assistant",
    # Second batch: how the work is actually titled on a board, plus broad domain terms.
    "event",
    "wedding",
    "audio",
    "DJ",
    "disc jockey",
    "photo",
    "video",
    "camera operator",
    "av technician",
    "social media manager",
    "studio assistant",
]

# Expansion candidates, grouped by which part of the resume they come from. The point is
# to find titles that mean the same work under a different name — a resume says "DJ" but
# the board says "event staff"; it says "photographer" but the posting says "media
# specialist". Measured at the settings the app now defaults to (100mi / 30d), because
# measuring new terms under the old restrictive ones would understate them.
EXPAND_TERMS = [
    # A. Photo/video production — LA MEDIA, Meet Week Co.
    "real estate photography",
    "product photography",
    "video production",
    "multimedia specialist",
    "media specialist",
    "digital content",
    "content producer",
    "post production",
    "creative services",
    "media production",
    # B. Live event / AV — Meet Week live-stream, Complete Weddings, The Mill Top
    "av",
    "audiovisual",
    "audio visual technician",
    "event technician",
    "event production",
    "live event",
    "stagehand",
    "event setup",
    "banquet",
    "catering",
    "streaming",
    "live stream",
    # C. Weddings / entertainment — Complete Weddings + Events
    "entertainment",
    "wedding coordinator",
    "bridal",
    # D. Strength sport / fitness — Moran Academy, Meet Week, LA Fitness
    "strength coach",
    "sports performance",
    "personal trainer",
    "fitness coach",
    "group fitness",
    "weightlifting",
    "sports event",
    # E. Logistics — Amazon
    "warehouse",
    "logistics",
    "material handler",
    "inventory",
    "fulfillment",
    # F. E-commerce / resale / electronics — eBay refurb, liquidation
    "e-commerce",
    "resale",
    "merchandiser",
    "electronics technician",
    # G. Software — Butterfield LLC
    "web developer",
    "full stack",
    "it support",
    # H. Adjacent roles that hire media people — the titles the work actually hides behind
    "marketing coordinator",
    "communications specialist",
    "social media",
    "brand ambassador",
    "creative director",
]

# Location spellings and radii. jobspy passes `distance` to Indeed only.
GEO = [
    ("Indianapolis, IN", 25, 168),
    ("Indianapolis, IN", 50, 168),
    ("Indianapolis, IN", 100, 168),
    ("Carmel, IN", 50, 168),
    ("Fishers, IN", 50, 168),
    ("Indiana", 50, 168),
    ("Indianapolis, IN", 50, 720),
]

PACE_SECONDS = 4.0


def run(term: str, location: str, distance: int, hours: int) -> dict:
    started = time.time()
    try:
        df = scrape_jobs(
            site_name=["indeed"],
            search_term=term,
            location=location,
            results_wanted=100,
            hours_old=hours,
            country_indeed="USA",
            distance=distance,
            enforce_annual_salary=False,
            verbose=0,
        )
        n = 0 if df is None else len(df)
        urls: set[str] = set()
        if df is not None and n:
            for _, row in df.iterrows():
                u = row.get("job_url") or row.get("job_url_direct") or ""
                key = str(u).split("jk=")[-1] if "jk=" in str(u) else str(u)
                urls.add(key)
        return {
            "term": term, "location": location, "distance": distance, "hours": hours,
            "rows": n, "unique": len(urls), "seconds": round(time.time() - started, 1),
            "error": None,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "term": term, "location": location, "distance": distance, "hours": hours,
            "rows": 0, "unique": 0, "seconds": round(time.time() - started, 1),
            "error": f"{type(e).__name__}: {e}",
        }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["terms", "geo", "expand"], default="terms")
    args = ap.parse_args()

    results: list[dict] = []
    if OUT.exists():
        results = json.loads(OUT.read_text())

    if args.phase == "terms":
        jobs = [(t, "Indianapolis, IN", 50, 168) for t in TERMS]
    elif args.phase == "expand":
        # The settings the app now defaults to, so the numbers are comparable to what a
        # real run would return rather than to the old restrictive baseline.
        jobs = [(t, "Indianapolis, IN", 100, 720) for t in EXPAND_TERMS]
    else:
        jobs = [
            (t, loc, dist, hrs)
            for (loc, dist, hrs) in GEO
            for t in ("photo", "event staff")
        ]

    for term, loc, dist, hrs in jobs:
        already = any(
            r["term"] == term and r["location"] == loc and r["distance"] == dist and r["hours"] == hrs
            for r in results
        )
        if already:
            continue
        r = run(term, loc, dist, hrs)
        results.append(r)
        flag = f" ERROR {r['error']}" if r["error"] else ""
        print(
            f"{r['term'][:24]:26} {loc[:16]:18} d={dist:<4} h={hrs:<4} "
            f"rows={r['rows']:<4} unique={r['unique']:<4} {r['seconds']}s{flag}",
            flush=True,
        )
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(results, indent=1))
        time.sleep(PACE_SECONDS)

    # Summary
    print("\n=== summary ===")
    if args.phase == "terms":
        print(f"{'term':26} {'rows':>5} {'unique':>7}")
        for r in sorted(
            [x for x in results if x["distance"] == 50 and x["hours"] == 168
             and x["location"] == "Indianapolis, IN"],
            key=lambda x: -x["unique"],
        ):
            print(f"{r['term']:26} {r['rows']:>5} {r['unique']:>7}")
    elif args.phase == "expand":
        print(f"{'term':28} {'rows':>5} {'unique':>7}")
        for r in sorted(
            [x for x in results if x["distance"] == 100 and x["hours"] == 720],
            key=lambda x: -x["unique"],
        ):
            print(f"{r['term']:28} {r['rows']:>5} {r['unique']:>7}")
    else:
        print(f"{'location':18} {'dist':>5} {'hours':>6} {'term':26} {'unique':>7}")
        for r in sorted(results, key=lambda x: (x["location"], x["distance"], x["hours"], x["term"])):
            print(f"{r['location']:18} {r['distance']:>5} {r['hours']:>6} {r['term']:26} {r['unique']:>7}")


if __name__ == "__main__":
    main()
