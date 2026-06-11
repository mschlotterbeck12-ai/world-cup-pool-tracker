#!/usr/bin/env python3
"""Trim the raw FotMob league payload into data/snapshot.js for the tracker site."""
import json
import re
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "fotmob_raw.json"
OUT = ROOT / "data" / "snapshot.js"


def parse_score(status):
    s = status.get("scoreStr")
    if not s:
        return None, None
    m = re.match(r"\s*(\d+)\s*-\s*(\d+)", s)
    if not m:
        return None, None
    return int(m.group(1)), int(m.group(2))


def trim(raw):
    matches = []
    for m in raw["fixtures"]["allMatches"]:
        st = m.get("status", {})
        h, a = parse_score(st)
        reason = st.get("reason") or {}
        matches.append({
            "id": str(m["id"]),
            "round": str(m.get("round", "")),
            "group": m.get("group"),
            "utc": st.get("utcTime"),
            "homeId": str(m["home"]["id"]),
            "homeName": m["home"]["name"],
            "awayId": str(m["away"]["id"]),
            "awayName": m["away"]["name"],
            "started": bool(st.get("started")),
            "finished": bool(st.get("finished")),
            "cancelled": bool(st.get("cancelled")),
            "scoreH": h,
            "scoreA": a,
            "reason": reason.get("short"),
        })

    groups = {}
    third_table = []
    for t in raw["table"][0]["data"]["tables"]:
        name = t["leagueName"]
        rows = []
        for r in t["table"]["all"]:
            gf, ga = 0, 0
            sm = re.match(r"\s*(\d+)\s*-\s*(\d+)", r.get("scoresStr") or "")
            if sm:
                gf, ga = int(sm.group(1)), int(sm.group(2))
            rows.append({
                "id": str(r["id"]),
                "name": r["name"],
                "played": r.get("played", 0),
                "w": r.get("wins", 0),
                "d": r.get("draws", 0),
                "l": r.get("losses", 0),
                "gf": gf,
                "ga": ga,
                "pts": r.get("pts", 0),
                "idx": r.get("idx", 0),
            })
        gm = re.match(r"Grp\.\s*([A-L])", name)
        if gm:
            groups[gm.group(1)] = rows
        elif "3rd" in name:
            third_table = rows

    return {
        "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "matches": matches,
        "groups": groups,
        "thirdTable": third_table,
    }


def main():
    raw = json.load(open(RAW))
    snap = trim(raw)
    OUT.write_text("window.WC_SNAPSHOT = " + json.dumps(snap) + ";\n")
    n_done = sum(1 for m in snap["matches"] if m["finished"])
    print(f"snapshot written: {len(snap['matches'])} matches ({n_done} finished), "
          f"{len(snap['groups'])} groups, fetched {snap['fetchedAt']}")


if __name__ == "__main__":
    sys.exit(main())
