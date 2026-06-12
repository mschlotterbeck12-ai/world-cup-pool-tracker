#!/usr/bin/env python3
"""Convert Dan's pool Google Sheet (CSV export) into data/entries.js — all real entries."""
import csv
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "entries.js"
SHEET_CSV = ("https://docs.google.com/spreadsheets/d/"
             "1Asj9Ec6dq_jxzi1n7vFbx0TcR4dFoxJExaqKE21uZEA/export?format=csv&gid=390094078")
TIER_COLS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26]

# Sheet spelling -> FotMob spelling
CANON = {
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Congo DR": "DR Congo",
    "Curaçao": "Curacao",
    "Türkiye": "Turkiye",
    "United States": "USA",
}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if src:
        text = Path(src).read_text()
    else:
        req = urllib.request.Request(SHEET_CSV, headers={"User-Agent": "Mozilla/5.0"})
        text = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")

    rows = list(csv.reader(text.splitlines()))
    entries, seen = [], {}
    for r in rows[1:]:
        if len(r) < 30 or not r[1].strip():
            continue
        teams = [r[i].strip() for i in TIER_COLS]
        if not all(teams):
            continue
        name = r[1].strip()
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            name = f"{name} ({seen[name]})"
        entries.append({"name": name, "teams": [CANON.get(t, t) for t in teams]})

    OUT.write_text("window.WC_POOL_ENTRIES = " + json.dumps(entries) + ";\n")
    print(f"entries.js written: {len(entries)} entries")


if __name__ == "__main__":
    main()
