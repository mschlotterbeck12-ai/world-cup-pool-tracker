# World Cup 2026 Pool Tracker

Tracks my 12-team entry in Dan Lynch's World Cup pool: live points from FotMob,
plus Monte Carlo odds of winning the pool.

## My entry

| Tier | Team | | Tier | Team |
|---|---|---|---|---|
| 1 | 🇫🇷 France | | 7 | 🇳🇴 Norway |
| 2 | 🇧🇷 Brazil | | 8 | 🇨🇮 Ivory Coast |
| 3 | 🇩🇪 Germany | | 9 ⚡ | 🇨🇿 Czechia |
| 4 | 🇺🇸 USA | | 10 ⚡ | 🇶🇦 Qatar |
| 5 | 🇯🇵 Japan | | 11 ⚡ | 🇸🇦 Saudi Arabia |
| 6 | 🇦🇹 Austria | | 12 ⚡ | 🇬🇭 Ghana |

⚡ = double points (tiers 9–12).

## Running it

```sh
cd "World Cup pool"
./update.sh                      # pull latest results from FotMob
python3 -m http.server 8765      # then open http://localhost:8765
```

The page also refreshes itself from FotMob in the browser (via CORS proxies) —
automatically every 90s while a match is live. `./update.sh` is the fallback if
the proxies are down; it rebuilds `data/snapshot.js`, which the page loads on start.

## Family rivals

Brother's and Dad's entries are pre-loaded (Settings → "Real rival entries"):

- **Brother:** France, Portugal, Belgium, Mexico, Switzerland, Ecuador, Egypt, Ivory Coast, Scotland, Uzbekistan, Bosnia, Ghana
- **Dad:** Argentina, Portugal, Germany, Mexico, Switzerland, Ecuador, Canada, Sweden, DR Congo, Uzbekistan, Bosnia, Ghana

The **Pool standings** section ranks all real entries by live points with each
entry's projected final score and win/top-3 odds. Add more rivals in Settings as
Dan shares them.

## What's on the page

- **Pool standings** — leaderboard of all real entries: live points, projection, win odds.
- **Header** — my current points, chance to win the pool, chance of top-3 (cash),
  projected final score (10th–90th percentile), and the typical score it takes to win.
- **Team cards** — per team: points banked (goals / group results / bonuses / knockout),
  live-game glow, sim odds (advance, QF, champion) and expected final points (xPts).
- **Histogram** — distribution of my final score across 2,000 simulated tournaments.
- **Groups** — all 12 group tables plus FotMob's live "best 3rd-placed teams" table
  (top 8 advance — this is what decides the double-point bonus for Czechia/Qatar/Saudi/Ghana).
- **Schedule** — every match involving one of my teams.
- **Settings** — pool size, sim count, scoring rules (JSON), and a box to paste
  rivals' real entries once you know them (makes the win-odds real instead of
  simulated-field estimates).

## How the odds work

Remaining matches are simulated with a Poisson goal model driven by Elo-style
ratings derived from FIFA rankings (+50 Elo for the three hosts). Results already
played are locked in. Group tiebreaks, the best-3rd table, the real Round-of-32
bracket slots, and the third-place allocation constraints are all modeled. Each
simulated tournament is scored for my entry and for the rival field (real rivals
if pasted in Settings, otherwise rank-weighted random entries), giving P(win) and P(top 3).

## ⚠️ One rules ambiguity to confirm with Dan

The pool sheet assumed 16 groups of 3 with 16 teams advancing. The real 2026 format
is 12 groups of 4 with a **Round of 32** (32 teams advance). This tracker scores
knockout bonuses literally: clearing the R32 earns nothing by itself; the +4 starts
at the actual Round of 16. If Dan rules that advancing past groups/R32 should pay
the +4 differently, edit `reachR32` / `reachR16` in Settings → Scoring rules.
