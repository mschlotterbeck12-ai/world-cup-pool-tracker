#!/usr/bin/env bash
# Refresh tournament data from FotMob and rebuild data/snapshot.js
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
curl -s -m 30 "https://www.fotmob.com/api/data/leagues?id=77&tab=matches" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36" \
  -H "Accept: application/json" \
  -o "$DIR/data/fotmob_raw.json"
python3 "$DIR/scripts/make_snapshot.py"
