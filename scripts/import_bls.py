#!/usr/bin/env python3
"""
Download and import BLS Indiana OES wage data into the job-hunt SQLite database.

Source: Bureau of Labor Statistics Occupational Employment and Wage Statistics (OEWS)
        May 2024 state-level estimates
URL: https://www.bls.gov/oes/special.requests/oesm24st.zip

Usage:
    python3 scripts/import_bls.py

Requirements:
    pip install openpyxl
"""

import sys
import io
import json
import zipfile
import sqlite3
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "jobhunt.db"
LOCAL_ZIP = PROJECT_ROOT / "data" / "bls_oesm24st.zip"

BLS_URL = "https://www.bls.gov/oes/special.requests/oesm24st.zip"
DATA_YEAR = 2024


def main():
    print("=== BLS Indiana OEWS Import ===", flush=True)

    # ── 1. Get ZIP data (download or use cached local file) ──────────────────
    if LOCAL_ZIP.exists():
        print(f"Using local file: {LOCAL_ZIP}", flush=True)
        zip_bytes = LOCAL_ZIP.read_bytes()
    else:
        print(f"Downloading from {BLS_URL} …", flush=True)
        req = urllib.request.Request(BLS_URL, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                zip_bytes = resp.read()
        except Exception as e:
            abort(
                f"Download failed: {e}\n"
                f"If download is blocked, manually download the file from:\n"
                f"  {BLS_URL}\n"
                f"and save it to: {LOCAL_ZIP}"
            )
        print(f"Downloaded {len(zip_bytes) / 1024 / 1024:.1f} MB", flush=True)

    # ── 2. Find and read the Excel file from the ZIP ─────────────────────────
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        xlsx_names = [n for n in z.namelist() if n.lower().endswith(".xlsx")]
        if not xlsx_names:
            abort(f"No .xlsx file found in ZIP. Contents: {z.namelist()[:20]}")
        # The largest XLSX file is the combined all-states workbook
        target = max(xlsx_names, key=lambda n: z.getinfo(n).file_size)
        print(f"Reading: {target}", flush=True)
        xlsx_bytes = z.read(target)

    # ── 3. Parse with openpyxl ───────────────────────────────────────────────
    try:
        import openpyxl
    except ImportError:
        abort("openpyxl not installed. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)

    # Find header row
    header = {}
    for row in rows_iter:
        cells = [str(c).strip().upper().replace(" ", "_") if c is not None else "" for c in row]
        if "OCC_CODE" in cells:
            header = {name: i for i, name in enumerate(cells) if name}
            break

    if not header:
        abort("Could not find OCC_CODE column in Excel file — BLS file format may have changed")

    print(f"Header columns: {list(header.keys())[:12]}", flush=True)

    def get(row, col):
        idx = header.get(col)
        return row[idx] if idx is not None and idx < len(row) else None

    def wage(val):
        if val is None:
            return None
        s = str(val).strip().replace(",", "").replace("$", "")
        if s in ("*", "**", "", "None", "nan"):
            return None
        if s == "#":
            return 208000  # BLS reports ">$208,000" as this cap
        try:
            return int(float(s))
        except (ValueError, TypeError):
            return None

    records = []
    for row in rows_iter:
        area  = str(get(row, "AREA_TITLE") or "").strip()
        igrp  = str(get(row, "I_GROUP")    or "").strip().lower()
        ogrp  = str(get(row, "O_GROUP")    or "").strip().lower()
        own   = str(get(row, "OWN_CODE")   or "").strip()
        code  = str(get(row, "OCC_CODE")   or "").strip()
        title = str(get(row, "OCC_TITLE")  or "").strip()

        # Keep only: Indiana statewide, cross-industry, all ownership, detailed occupations
        if "indiana" not in area.lower():
            continue
        if igrp not in ("cross-industry", ""):
            continue
        if own not in ("0", "1", "5", ""):
            continue
        if ogrp != "detailed":
            continue
        if not code or code.endswith("-0000"):
            continue

        tot_raw = get(row, "TOT_EMP")
        try:
            tot = int(str(tot_raw).replace(",", "")) if tot_raw else None
        except (ValueError, TypeError):
            tot = None

        records.append((
            code, title,
            wage(get(row, "A_MEDIAN")),
            wage(get(row, "A_PCT25")),
            wage(get(row, "A_PCT75")),
            wage(get(row, "A_MEAN")),
            tot,
            DATA_YEAR,
        ))

    wb.close()
    print(f"Indiana occupations parsed: {len(records)}", flush=True)

    if not records:
        abort("No Indiana rows found — BLS file format may have changed. Check AREA_TITLE and O_GROUP columns.")

    # ── 4. Import into SQLite ────────────────────────────────────────────────
    if not DB_PATH.exists():
        abort(f"Database not found at {DB_PATH} — start the app first to initialize it")

    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("""
        CREATE TABLE IF NOT EXISTS bls_wages (
            occ_code  TEXT PRIMARY KEY,
            occ_title TEXT NOT NULL,
            a_median  INTEGER,
            a_pct25   INTEGER,
            a_pct75   INTEGER,
            a_mean    INTEGER,
            tot_emp   INTEGER,
            data_year INTEGER
        )
    """)
    con.execute("DELETE FROM bls_wages")
    con.executemany("INSERT INTO bls_wages VALUES (?,?,?,?,?,?,?,?)", records)
    con.commit()
    count = con.execute("SELECT COUNT(*) FROM bls_wages").fetchone()[0]
    con.close()

    print(f"Inserted {count} rows into bls_wages", flush=True)
    print(json.dumps({"success": True, "count": count, "year": DATA_YEAR}))


def abort(msg):
    print(f"ERROR: {msg}", file=sys.stderr, flush=True)
    print(json.dumps({"success": False, "error": msg}))
    sys.exit(1)


if __name__ == "__main__":
    main()
