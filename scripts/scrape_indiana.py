#!/usr/bin/env python3
"""
Work for Indiana scraper — two-phase Playwright scraper.

Phase 1: Paginate through search results, extracting title, location, salary,
         date posted, and job detail URL from each row.
Phase 2: Visit each job detail page to fetch the full description.

Usage:
    python3 scripts/scrape_indiana.py
    python3 scripts/scrape_indiana.py --keyword nurse --location Indianapolis
    python3 scripts/scrape_indiana.py --keyword "" --location "" --out /tmp/indiana.csv
    python3 scripts/scrape_indiana.py --max-pages 5

Requirements:
    pip install playwright
    playwright install chromium
"""

import argparse
import csv
import io
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, quote

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://workforindiana.in.gov"
SEARCH_PATH = "/search/"

# ── Helpers ──────────────────────────────────────────────────────────────────

def build_search_url(keyword: str, location: str) -> str:
    params = {
        "searchby": "location",
        "createNewAlert": "false",
        "q": keyword or "",
        "locationsearch": location or "",
        "geolocation": "",
        "optionsFacetsDD_customfield3": "",
        "optionsFacetsDD_city": "",
        "optionsFacetsDD_customfield1": "",
    }
    return f"{BASE_URL}{SEARCH_PATH}?{urlencode(params, quote_via=quote)}"


def parse_salary(text: str) -> str | None:
    """Return raw salary text if present, else None."""
    if not text or not text.strip():
        return None
    cleaned = text.strip()
    return cleaned if "$" in cleaned or "salary" in cleaned.lower() else None


# ── Phase 1: Scrape listing rows from search results ────────────────────────

def phase1_collect_listings(page, max_pages: int) -> list[dict]:
    """Collect all job listing rows across pages. Returns list of dicts with
    title, location, salary, date_posted, url (no description yet)."""
    listings = []
    page_num = 1

    while True:
        print(f"  [Phase 1] Scraping results page {page_num}…", file=sys.stderr, flush=True)

        # Wait for results table to appear
        try:
            page.wait_for_selector("table#searchresults tbody tr, table tbody tr, .search-results table tbody tr", timeout=30000)
        except PlaywrightTimeout:
            # Maybe no results or page structure differs — try broader selectors
            if page_num == 1:
                print(f"  [Phase 1] No results table found on first page.", file=sys.stderr)
            break

        # Try multiple selector strategies for the results table
        rows = page.query_selector_all("table#searchresults tbody tr")
        if not rows:
            rows = page.query_selector_all("table.search-results tbody tr")
        if not rows:
            rows = page.query_selector_all("table tbody tr")

        # Filter out header rows (rows containing th elements)
        data_rows = [r for r in rows if not r.query_selector_all("th")]

        if not data_rows:
            if page_num == 1:
                print(f"  [Phase 1] No data rows found on first page.", file=sys.stderr)
            break

        for row in data_rows:
            cells = row.query_selector_all("td")
            if len(cells) < 2:
                continue

            # Column layout per user: Title, Location, Min Salary, Date Posted
            # Some configurations may have fewer/more cells, so be defensive
            title_text = ""
            location_text = ""
            salary_text = ""
            date_text = ""
            job_url = None

            # Try to find the link (usually in the first/title cell)
            link_el = row.query_selector("a[href]")
            if link_el:
                job_url = link_el.get_attribute("href")
                if job_url and not job_url.startswith("http"):
                    job_url = f"{BASE_URL}{job_url}"
                title_text = (link_el.inner_text() or "").strip()

            # Extract cell texts
            cell_texts = [(c.inner_text() or "").strip() for c in cells]

            if len(cell_texts) >= 1 and not title_text:
                title_text = cell_texts[0]
            if len(cell_texts) >= 2:
                location_text = cell_texts[1]
            if len(cell_texts) >= 3:
                salary_text = parse_salary(cell_texts[2]) or ""
            if len(cell_texts) >= 4:
                date_text = cell_texts[3]
            elif len(cell_texts) >= 3 and "/" in cell_texts[-1]:
                # Date often contains slashes like "06/15/2026"
                date_text = cell_texts[-1]

            if not title_text:
                continue

            listings.append({
                "title": title_text,
                "location": location_text or None,
                "salary": salary_text or None,
                "date_posted": date_text or None,
                "url": job_url,
            })

        print(f"  [Phase 1] Found {len(data_rows)} listings on page {page_num} (total: {len(listings)})", file=sys.stderr)

        # Check for next page
        if max_pages and page_num >= max_pages:
            print(f"  [Phase 1] Reached max pages ({max_pages}).", file=sys.stderr)
            break

        # Look for "Next" pagination link
        next_btn = page.query_selector("a:has-text('Next'), a[aria-label='Next'], .pagination a.next, a.next")
        if not next_btn:
            # Try finding by rel=next or common pagination patterns
            next_btn = page.query_selector("li.next a, a[rel='next']")

        if next_btn:
            try:
                next_btn.click()
                page.wait_for_load_state("networkidle", timeout=30000)
                time.sleep(2)  # Allow Cloudflare/settle time
                page_num += 1
            except Exception as e:
                print(f"  [Phase 1] Pagination stopped: {e}", file=sys.stderr)
                break
        else:
            print(f"  [Phase 1] No next page button found — done at page {page_num}.", file=sys.stderr)
            break

    return listings


# ── Phase 2: Fetch individual job descriptions ───────────────────────────────

def phase2_fetch_descriptions(page, listings: list[dict]) -> list[dict]:
    """Visit each job's detail page and extract the full description."""
    total = len(listings)
    for i, listing in enumerate(listings):
        url = listing.get("url")
        if not url:
            listing["description"] = None
            continue

        pct = round((i + 1) / total * 100)
        print(f"  [Phase 2] Fetching {i+1}/{total} ({pct}%): {listing['title'][:60]}…", file=sys.stderr, flush=True)

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(1)  # Let dynamic content settle

            # Try multiple selectors for job description content
            desc = None
            desc_selectors = [
                "#divJobDescription",
                ".job-description",
                "[id*='jobdesc' i]",
                "[id*='description' i]",
                ".detail-data-content",
                "article",
            ]
            for sel in desc_selectors:
                el = page.query_selector(sel)
                if el:
                    desc = (el.inner_text() or "").strip()
                    if desc and len(desc) > 20:
                        break

            # Fallback: grab the main content area
            if not desc:
                body = page.query_selector("body")
                if body:
                    full_text = (body.inner_text() or "").strip()
                    # Take the longest reasonable chunk (heuristic)
                    if len(full_text) > 50:
                        # Trim to first 5000 chars to avoid noise
                        desc = full_text[:5000]

            listing["description"] = desc if desc else None

        except PlaywrightTimeout:
            print(f"  [Phase 2] Timeout fetching: {url}", file=sys.stderr)
            listing["description"] = None
        except Exception as e:
            print(f"  [Phase 2] Error fetching {url}: {e}", file=sys.stderr)
            listing["description"] = None

    return listings


# ── CSV output ───────────────────────────────────────────────────────────────

def sanitize_csv_field(value: str) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading characters.

    Fields starting with =, +, -, @, tab, or carriage return can be interpreted
    as formulas by spreadsheet applications (Excel, Google Sheets, LibreOffice).
    Prefixing with a single quote forces text interpretation.
    """
    if value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def write_csv(listings: list[dict], out_path: Path) -> None:
    """Write listings to CSV."""
    fieldnames = ["Title", "Company", "Location", "Salary", "Date Posted", "Job URL", "Description"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for listing in listings:
        writer.writerow({
            "Title": sanitize_csv_field(listing.get("title", "")),
            "Company": "State of Indiana",
            "Location": sanitize_csv_field(listing.get("location", "") or ""),
            "Salary": sanitize_csv_field(listing.get("salary", "") or ""),
            "Date Posted": sanitize_csv_field(listing.get("date_posted", "") or ""),
            "Job URL": sanitize_csv_field(listing.get("url", "") or ""),
            "Description": sanitize_csv_field((listing.get("description", "") or "")[:8000]),
        })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(buf.getvalue(), encoding="utf-8")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Work for Indiana job listings")
    parser.add_argument("--keyword", default="", help="Search keyword (e.g. 'nurse')")
    parser.add_argument("--location", default="", help="Location filter (e.g. 'Indianapolis')")
    parser.add_argument("--out", default=None, help="Output CSV path (default: /tmp/indiana_jobs.csv)")
    parser.add_argument("--max-pages", type=int, default=0, help="Max result pages (0 = all)")
    parser.add_argument("--skip-descriptions", action="store_true", help="Skip Phase 2 (no descriptions)")
    args = parser.parse_args()

    out_path = Path(args.out or "/tmp/indiana_jobs.csv")
    search_url = build_search_url(args.keyword, args.location)
    max_pages = args.max_pages if args.max_pages > 0 else 999

    print(f"Work for Indiana Scraper", file=sys.stderr)
    print(f"  Search URL: {search_url}", file=sys.stderr)
    print(f"  Output: {out_path}", file=sys.stderr)
    print(f"  Max pages: {max_pages}", file=sys.stderr)
    print(f"  Skip descriptions: {args.skip_descriptions}", file=sys.stderr)
    print(file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
            timezone_id="America/Indiana/Indianapolis",
        )
        # Block unnecessary resources to speed up scraping
        context.route("**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot}", lambda route: route.abort())
        context.route("**/analytics/**", lambda route: route.abort())
        context.route("**/tracking/**", lambda route: route.abort())

        page = context.new_page()

        # ── Navigate to search results ──
        print(f"[Phase 1] Loading search results…", file=sys.stderr, flush=True)
        try:
            page.goto(search_url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(3)  # Allow Cloudflare challenge to resolve
        except PlaywrightTimeout:
            print("ERROR: Timed out loading search page. The site may be blocking automated access.", file=sys.stderr)
            browser.close()
            sys.exit(1)

        # Check if we got blocked
        title = page.title() or ""
        if "cloudflare" in title.lower() or "attention required" in title.lower():
            print("ERROR: Blocked by Cloudflare. Try again later or use a different IP.", file=sys.stderr)
            browser.close()
            sys.exit(1)

        # ── Phase 1: Collect listings ──
        listings = phase1_collect_listings(page, max_pages)
        print(f"\n[Phase 1] Complete: {len(listings)} listings collected.\n", file=sys.stderr)

        if not listings:
            print("No listings found. Writing empty CSV.", file=sys.stderr)
            write_csv([], out_path)
            print(f"Saved → {out_path}", file=sys.stderr)
            browser.close()
            sys.exit(0)

        # ── Phase 2: Fetch descriptions ──
        if not args.skip_descriptions:
            listings = phase2_fetch_descriptions(page, listings)
            desc_count = sum(1 for l in listings if l.get("description"))
            print(f"\n[Phase 2] Complete: {desc_count}/{len(listings)} descriptions fetched.\n", file=sys.stderr)
        else:
            for l in listings:
                l["description"] = None
            print(f"\n[Phase 2] Skipped (--skip-descriptions).\n", file=sys.stderr)

        browser.close()

    # ── Write CSV ──
    write_csv(listings, out_path)
    print(f"Saved → {out_path} ({len(listings)} listings)", file=sys.stderr, flush=True)
    # Print count to stdout so the API can parse it
    print(len(listings))


if __name__ == "__main__":
    main()
