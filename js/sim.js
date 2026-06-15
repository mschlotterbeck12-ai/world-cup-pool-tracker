// Monte Carlo tournament simulator: simulates the rest of the World Cup thousands
// of times (respecting results already in the books) to estimate my final points,
// each team's odds of advancing, and my chance of winning Dan's pool.
(function () {
  const TEAM_NAMES = Object.keys(WC.TEAMS);

  function elo(name, opts) {
    let e = 2150 - 8.2 * WC.TEAMS[name].rank;
    if (WC.HOSTS.has(name)) e += opts.hostBoost;
    return e;
  }

  function poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  // Expected goals for each side from the Elo gap.
  function lambdas(eA, eB) {
    const d = (eA - eB) / 650;
    return [1.30 * Math.exp(d), 1.30 * Math.exp(-d)];
  }

  function simGoals(eA, eB, scale) {
    const [lA, lB] = lambdas(eA, eB);
    return [poisson(lA * (scale || 1)), poisson(lB * (scale || 1))];
  }

  // ---------- one full tournament ----------
  // Returns rec[teamName] = {goals, wins, draws, rank, advanced, reached:{}, champion, bronzeWinner}
  function simulateTournament(data, opts) {
    const rec = {};
    for (const t of TEAM_NAMES) {
      rec[t] = { goals: 0, wins: 0, draws: 0, rank: null, advanced: false, reached: {}, champion: false, bronzeWinner: false };
    }
    const addResult = (a, b, ga, gb, isGroup) => {
      rec[a].goals += ga; rec[b].goals += gb;
      if (isGroup) {
        if (ga > gb) rec[a].wins++;
        else if (gb > ga) rec[b].wins++;
        else { rec[a].draws++; rec[b].draws++; }
      }
    };

    // matchId -> winning team name (null = draw); recorded for every match played
    const results = {};

    // --- group stage ---
    const standings = {}; // letter -> [teamName ordered]
    const thirds = [];    // {team, pts, gd, gf}
    for (const [letter, rows] of Object.entries(data.groupTeams)) {
      const table = {};
      for (const t of rows) table[t] = { pts: 0, gd: 0, gf: 0 };
      for (const m of data.groupMatches[letter]) {
        let ga, gb;
        if (m.finished && m.scoreH != null) {
          ga = m.scoreH; gb = m.scoreA;
        } else if (m.started && m.scoreH != null) {
          // live: current score plus a partial-match tail
          const [xa, xb] = simGoals(elo(m.homeName, opts), elo(m.awayName, opts), 0.45);
          ga = m.scoreH + xa; gb = m.scoreA + xb;
        } else {
          [ga, gb] = simGoals(elo(m.homeName, opts), elo(m.awayName, opts));
        }
        addResult(m.homeName, m.awayName, ga, gb, true);
        results[m.id] = ga > gb ? m.homeName : gb > ga ? m.awayName : null;
        const A = table[m.homeName], B = table[m.awayName];
        A.gf += ga; A.gd += ga - gb; B.gf += gb; B.gd += gb - ga;
        if (ga > gb) A.pts += 3; else if (gb > ga) B.pts += 3; else { A.pts++; B.pts++; }
      }
      const order = rows.slice().sort((a, b) =>
        table[b].pts - table[a].pts || table[b].gd - table[a].gd ||
        table[b].gf - table[a].gf || Math.random() - 0.5);
      // If the group is fully played in reality, trust FotMob's official ordering.
      if (data.completeGroups[letter]) {
        standings[letter] = data.completeGroups[letter];
      } else {
        standings[letter] = order;
      }
      standings[letter].forEach((t, i) => { rec[t].rank = i + 1; });
      const third = standings[letter][2];
      thirds.push({ team: third, ...table[third] });
    }

    // --- best 8 thirds ---
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || Math.random() - 0.5);
    const qualifiedThirds = new Set(thirds.slice(0, 8).map(x => x.team));
    for (const [letter, order] of Object.entries(standings)) {
      rec[order[0]].advanced = true; rec[order[1]].advanced = true;
      if (qualifiedThirds.has(order[2])) rec[order[2]].advanced = true;
    }

    // --- assign thirds to R32 slots (randomized backtracking) ---
    const thirdSlots = [];
    for (const [mid, slots] of Object.entries(WC.R32_TEMPLATE)) {
      for (const s of slots) if (s.startsWith("3:")) thirdSlots.push({ slot: s, allowed: s.slice(2) });
    }
    const qt = [...qualifiedThirds].map(t => ({ team: t, letter: WC.TEAMS[t].group }));
    const slotAssign = matchThirds(thirdSlots, qt);

    // --- knockout ---
    const resolveSlot = (s) => {
      if (s.startsWith("3:")) return slotAssign[s];
      const letter = s[1] === undefined ? null : s.slice(1);
      return standings[letter][parseInt(s[0], 10) - 1];
    };
    const winners = {}, losers = {}; // matchId -> teamName
    const playKO = (mid, a, b, roundKey) => {
      const real = data.koReal[mid];
      // If FotMob already knows the real entrants, they override the simulated path.
      if (real && real.realTeams) { a = real.homeName; b = real.awayName; }
      rec[a].reached[roundKey] = true; rec[b].reached[roundKey] = true;
      let ga, gb, w;
      if (real && real.finished && real.scoreH != null) {
        ga = real.scoreH; gb = real.scoreA;
        w = real.winner || (Math.random() < winProb(a, b, opts) ? a : b); // pens unresolved
      } else {
        [ga, gb] = simGoals(elo(a, opts), elo(b, opts));
        if (ga === gb) {
          const [ea, eb] = simGoals(elo(a, opts), elo(b, opts), 0.33); // extra time
          ga += ea; gb += eb;
        }
        w = ga > gb ? a : gb > ga ? b : (Math.random() < winProb(a, b, opts) ? a : b);
      }
      addResult(a, b, ga, gb, false);
      winners[mid] = w; losers[mid] = w === a ? b : a;
      results[mid] = w;
      return w;
    };

    const ROUND_KEY = {};
    for (const mid of Object.keys(WC.R32_TEMPLATE)) ROUND_KEY[mid] = "R32";
    const koIds = Object.keys(WC.KO_TEMPLATE);
    // template order: R16 (8), QF (4), SF (2), Final (1) — derive round by depth
    const r16 = koIds.slice(0, 8), qf = koIds.slice(8, 12), sf = koIds.slice(12, 14);

    for (const [mid, slots] of Object.entries(WC.R32_TEMPLATE)) {
      playKO(mid, resolveSlot(slots[0]), resolveSlot(slots[1]), "R32");
    }
    for (const mid of r16) {
      const [f1, f2] = WC.KO_TEMPLATE[mid];
      playKO(mid, winners[f1], winners[f2], "R16");
    }
    for (const mid of qf) {
      const [f1, f2] = WC.KO_TEMPLATE[mid];
      playKO(mid, winners[f1], winners[f2], "QF");
    }
    for (const mid of sf) {
      const [f1, f2] = WC.KO_TEMPLATE[mid];
      playKO(mid, winners[f1], winners[f2], "SF");
    }
    // bronze
    const bz = playKO(WC.BRONZE_ID, losers[sf[0]], losers[sf[1]], "BRONZE");
    rec[bz].bronzeWinner = true;
    // final
    const [ff1, ff2] = WC.KO_TEMPLATE[WC.FINAL_ID];
    const champ = playKO(WC.FINAL_ID, winners[ff1], winners[ff2], "FINAL");
    rec[champ].champion = true;
    return { rec, results };
  }

  function winProb(a, b, opts) {
    const d = (elo(a, opts) - elo(b, opts)) / 400;
    const p = 1 / (1 + Math.pow(10, -d));
    return 0.5 + (p - 0.5) * 0.6; // shootouts are closer to a coin flip
  }

  // Bipartite matching of qualified thirds to slot constraints.
  function matchThirds(slots, thirds) {
    const order = slots.slice();
    for (let attempt = 0; attempt < 30; attempt++) {
      shuffle(order); shuffle(thirds);
      const used = new Set(), assign = {};
      if (backtrack(order, thirds, 0, used, assign)) return assign;
    }
    // fallback: greedy ignoring constraints (shouldn't happen)
    const assign = {};
    slots.forEach((s, i) => { assign[s.slot] = thirds[i % thirds.length].team; });
    return assign;
  }
  function backtrack(slots, thirds, i, used, assign) {
    if (i === slots.length) return true;
    const s = slots[i];
    for (const t of thirds) {
      if (used.has(t.team) || !s.allowed.includes(t.letter)) continue;
      used.add(t.team); assign[s.slot] = t.team;
      if (backtrack(slots, thirds, i + 1, used, assign)) return true;
      used.delete(t.team); delete assign[s.slot];
    }
    return false;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  // Score a 12-pick entry against one simulated tournament record.
  function scoreSimEntry(picks, rec, scoring) {
    let total = 0;
    for (const p of picks) {
      const r = rec[p.name];
      let pts = r.goals * scoring.goal + r.wins * scoring.groupWin + r.draws * scoring.groupDraw;
      if (r.rank === 1) pts += scoring.finish1st;
      else if (r.rank === 2) pts += scoring.finish2nd;
      else if (r.rank === 3 && r.advanced) pts += scoring.finish3rdAdvance;
      if (r.reached.R32) pts += scoring.reachR32;
      if (r.reached.R16) pts += scoring.reachR16;
      if (r.reached.QF) pts += scoring.reachQF;
      if (r.reached.SF) pts += scoring.reachSF;
      if (r.reached.FINAL) pts += scoring.reachFinal;
      if (r.champion) pts += scoring.winFinal;
      if (r.bronzeWinner) pts += scoring.winBronze;
      if (WC.DOUBLE_TIERS.has(p.tier)) pts *= 2;
      total += pts;
    }
    return total;
  }

  // Random rival entry: weighted toward better-ranked teams in each tier.
  function randomRival() {
    const picks = [];
    for (const [tier, teams] of Object.entries(WC.TIERS)) {
      const ws = teams.map(t => 1 / WC.TEAMS[t].rank);
      const sum = ws.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum, pick = teams[0];
      for (let i = 0; i < teams.length; i++) { r -= ws[i]; if (r <= 0) { pick = teams[i]; break; } }
      picks.push({ tier: +tier, name: pick });
    }
    return picks;
  }

  // Pre-process snapshot into sim-friendly structures.
  function prepData(snap) {
    const groupTeams = {}, groupMatches = {}, completeGroups = {}, koReal = {};
    for (const [letter, rows] of Object.entries(snap.groups)) {
      groupTeams[letter] = rows.map(r => r.name);
      groupMatches[letter] = [];
    }
    const realNames = new Set(TEAM_NAMES);
    for (const m of snap.matches) {
      if (m.group) {
        groupMatches[m.group].push(m);
      } else if (WC.ROUND_OF[m.round]) {
        koReal[m.id] = {
          realTeams: realNames.has(m.homeName) && realNames.has(m.awayName),
          homeName: m.homeName, awayName: m.awayName,
          finished: m.finished, scoreH: m.scoreH, scoreA: m.scoreA,
          winner: m.finished ? WCScoring.winnerOf(m, snap.matches) : null,
        };
      }
    }
    for (const [letter, ms] of Object.entries(groupMatches)) {
      if (ms.length && ms.every(x => x.finished)) {
        completeGroups[letter] = snap.groups[letter].slice().sort((a, b) => a.idx - b.idx).map(r => r.name);
      } else {
        completeGroups[letter] = null;
      }
    }
    return { groupTeams, groupMatches, completeGroups, koReal };
  }

  // ---------- main entry: run N sims over the real field, return aggregates ----------
  // entrants: [{label, picks}] with "Me" first. If the field setting exceeds the
  // real entries (no sheet loaded), the remainder is filled with random rivals.
  function run(snap, settings, entrants, onProgress, onDone) {
    const data = prepData(snap);
    const opts = { hostBoost: settings.hostBoost };
    const scoring = settings.scoring;
    const N = settings.nSims;
    const entAgg = entrants.map(() => ({ wins: 0, top3: 0, sum: 0 }));
    const entSeries = entrants.map(() => []);
    const nRandomRivals = Math.max(0, settings.fieldSize - entrants.length);

    // "Keys to winning": for selected entrants, track how top-3 odds shift with
    // each pick's milestone (2x tiers: advance; mid tiers: QF; top tiers: SF).
    const keyLabels = settings.keyLabels || [];
    const keyAgg = {};
    for (const e of entrants) {
      if (keyLabels.includes(e.label)) {
        keyAgg[e.label] = e.picks.map(() => ({ cond: 0, condTop3: 0, noTop3: 0 }));
      }
    }
    const milestone = (r, tier) => tier >= 9 ? r.advanced : tier >= 5 ? !!r.reached.QF : !!r.reached.SF;

    // "Games that matter": for family entries, track final points & top-3 conditional
    // on each of their teams winning vs not winning each upcoming match.
    const upcomingByTeam = {};
    for (const m of snap.matches) {
      if (m.finished || m.cancelled) continue;
      for (const nm of [m.homeName, m.awayName]) (upcomingByTeam[nm] = upcomingByTeam[nm] || []).push(m.id);
    }
    const matchPairs = {}, matchAgg = {};   // label -> [{mid,team}], label -> {key -> counters}
    for (const e of entrants) {
      if (!keyLabels.includes(e.label)) continue;
      const pairs = [];
      for (const p of e.picks) for (const mid of (upcomingByTeam[p.name] || [])) pairs.push({ mid, team: p.name });
      matchPairs[e.label] = pairs;
      const agg = {};
      for (const pr of pairs) agg[pr.mid + "|" + pr.team] = { wN: 0, wPts: 0, wT3: 0, eN: 0, ePts: 0, eT3: 0 };
      matchAgg[e.label] = agg;
    }

    const winningTotals = [];
    const cashTotals = [];   // 3rd-highest final total each sim (the cash line)
    const teamAgg = {};
    for (const name of TEAM_NAMES) {
      teamAgg[name] = { advance: 0, winGroup: 0, R16: 0, QF: 0, SF: 0, FINAL: 0, champion: 0, ptsSum: 0 };
    }

    let i = 0;
    function chunk() {
      const end = Math.min(i + 200, N);
      for (; i < end; i++) {
        const { rec, results } = simulateTournament(data, opts);
        for (const name of TEAM_NAMES) {
          const r = rec[name], a = teamAgg[name];
          if (r.advanced) a.advance++;
          if (r.rank === 1) a.winGroup++;
          for (const k of ["R16", "QF", "SF", "FINAL"]) if (r.reached[k]) a[k]++;
          if (r.champion) a.champion++;
          a.ptsSum += scoreSimEntry([{ tier: WC.TEAM_TIER[name], name }], rec, scoring);
        }
        const entTotals = entrants.map(e => scoreSimEntry(e.picks, rec, scoring));
        entTotals.forEach((t, ei) => entSeries[ei].push(t));
        const allTotals = entTotals.slice();
        for (let k = 0; k < nRandomRivals; k++) allTotals.push(scoreSimEntry(randomRival(), rec, scoring));
        const sorted = allTotals.slice().sort((a, b) => a - b);
        for (let ei = 0; ei < entrants.length; ei++) {
          const t = entTotals[ei];
          // binary search: entries strictly above t, and ties (excluding self)
          let lo = 0, hi = sorted.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= t) lo = m + 1; else hi = m; }
          const above = sorted.length - lo;
          let lo2 = 0, hi2 = lo;
          while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (sorted[m] < t) lo2 = m + 1; else hi2 = m; }
          const tied = lo - lo2 - 1;
          const place = above + 1 + (tied > 0 ? Math.floor(Math.random() * (tied + 1)) : 0);
          if (place === 1) entAgg[ei].wins++;
          if (place <= 3) entAgg[ei].top3++;
          entAgg[ei].sum += t;
          const label = entrants[ei].label;
          const ka = keyAgg[label];
          if (ka) {
            entrants[ei].picks.forEach((p, pk) => {
              if (milestone(rec[p.name], p.tier)) { ka[pk].cond++; if (place <= 3) ka[pk].condTop3++; }
              else if (place <= 3) ka[pk].noTop3++;
            });
          }
          const ma = matchAgg[label];
          if (ma) {
            const t3 = place <= 3 ? 1 : 0;
            for (const pr of matchPairs[label]) {
              const c = ma[pr.mid + "|" + pr.team];
              if (results[pr.mid] === pr.team) { c.wN++; c.wPts += t; c.wT3 += t3; }
              else { c.eN++; c.ePts += t; c.eT3 += t3; }
            }
          }
        }
        winningTotals.push(sorted[sorted.length - 1]);
        cashTotals.push(sorted[Math.max(0, sorted.length - 3)]);
      }
      if (onProgress) onProgress(i / N);
      if (i < N) setTimeout(chunk, 0);
      else finish();
    }

    function finish() {
      winningTotals.sort((a, b) => a - b);
      cashTotals.sort((a, b) => a - b);
      const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
      const teams = {};
      for (const [name, a] of Object.entries(teamAgg)) {
        teams[name] = {
          advance: a.advance / N, winGroup: a.winGroup / N, R16: a.R16 / N,
          QF: a.QF / N, SF: a.SF / N, FINAL: a.FINAL / N, champion: a.champion / N,
          xPts: a.ptsSum / N,
        };
      }
      onDone({
        n: N,
        nRandom: nRandomRivals,
        entrants: entrants.map((e, i) => {
          const tt = entSeries[i].sort((a, b) => a - b);
          return {
            label: e.label,
            pWin: entAgg[i].wins / N, pTop3: entAgg[i].top3 / N, mean: entAgg[i].sum / N,
            p10: q(tt, 0.10), p50: q(tt, 0.50), p90: q(tt, 0.90),
            totals: tt,
          };
        }),
        winningMedian: q(winningTotals, 0.50),
        cashMedian: q(cashTotals, 0.50),
        teams,
        keys: Object.fromEntries(entrants.filter(e => keyAgg[e.label]).map(e => [
          e.label,
          e.picks.map((p, pk) => {
            const a = keyAgg[e.label][pk];
            const pTop3IfYes = a.cond ? a.condTop3 / a.cond : 0;
            const pTop3IfNo = (N - a.cond) ? a.noTop3 / (N - a.cond) : 0;
            return { team: p.name, tier: p.tier, pCond: a.cond / N, pTop3IfYes, pTop3IfNo, delta: pTop3IfYes - pTop3IfNo };
          }),
        ])),
        matchImpact: Object.fromEntries(entrants.filter(e => matchAgg[e.label]).map(e => {
          const agg = matchAgg[e.label];
          const minN = Math.max(20, N * 0.01);   // both outcomes need enough samples
          const rows = matchPairs[e.label].map(pr => {
            const c = agg[pr.mid + "|" + pr.team];
            const ok = c.wN >= minN && c.eN >= minN;
            const t3IfWin = c.wN ? c.wT3 / c.wN : 0;
            const t3IfNot = c.eN ? c.eT3 / c.eN : 0;
            const ptsSwing = ok ? c.wPts / c.wN - c.ePts / c.eN : 0;
            const t3Swing = ok ? t3IfWin - t3IfNot : 0;
            return { matchId: pr.mid, team: pr.team, pWin: c.wN / (c.wN + c.eN || 1), ptsSwing, t3Swing, t3IfWin, t3IfNot };
          });
          return [e.label, rows];
        })),
      });
    }
    chunk();
  }

  window.WCSim = { run, randomRival, prepData };
})();
