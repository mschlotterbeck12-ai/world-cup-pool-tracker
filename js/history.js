// Historical reconstruction: re-scores the whole pool as of the end of each
// gameday (using only matches finished by then), producing points + rank series
// for the family chart. Knockout entrants are masked for days before they were
// knowable, so "reached round X" bonuses land on the right day.
(function () {
  const KO_IDS = new Set([...Object.keys(WC.KO_TEMPLATE), WC.BRONZE_ID]);

  function dayKey(utc) { return utc ? utc.slice(0, 10) : null; }

  // Which gamedays have at least one finished match.
  function gamedays(snap) {
    const days = new Set();
    for (const m of snap.matches) {
      if (m.finished && m.utc) days.add(dayKey(m.utc));
    }
    return [...days].sort();
  }

  // Snapshot as it looked at the end of `day` (YYYY-MM-DD).
  function snapshotAsOf(snap, day) {
    const byId = {};
    for (const m of snap.matches) byId[m.id] = m;
    const playedBy = (id) => {
      const m = byId[id];
      return m && m.finished && dayKey(m.utc) <= day;
    };
    const allGroupsDone = snap.matches.filter(m => m.group)
      .every(m => m.finished && dayKey(m.utc) <= day);

    const matches = snap.matches.map(m => {
      if (m.utc && dayKey(m.utc) <= day && m.finished) return m;
      // future (relative to `day`): hide result; hide knockout entrants not yet knowable
      const masked = { ...m, started: false, finished: false, scoreH: null, scoreA: null };
      if (WC.R32_TEMPLATE[m.id] && !allGroupsDone) {
        masked.homeName = "TBD"; masked.awayName = "TBD";
      } else if (KO_IDS.has(m.id)) {
        let feeders;
        if (m.id === WC.BRONZE_ID) {
          const sf = Object.keys(WC.KO_TEMPLATE).slice(12, 14);
          feeders = sf;
        } else {
          feeders = WC.KO_TEMPLATE[m.id];
        }
        if (!feeders.every(playedBy)) { masked.homeName = "TBD"; masked.awayName = "TBD"; }
      }
      return masked;
    });

    // Recompute group tables from the as-of matches (current FotMob idx breaks
    // remaining ties so completed groups match the official order).
    const curIdx = {};
    for (const rows of Object.values(snap.groups)) for (const r of rows) curIdx[r.name] = r.idx;
    const groups = {};
    const thirds = [];
    for (const [letter, rows] of Object.entries(snap.groups)) {
      const stat = {};
      for (const r of rows) stat[r.name] = { name: r.name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      for (const m of matches) {
        if (m.group !== letter || !m.finished || m.scoreH == null) continue;
        const A = stat[m.homeName], B = stat[m.awayName];
        if (!A || !B) continue;
        A.played++; B.played++;
        A.gf += m.scoreH; A.ga += m.scoreA; B.gf += m.scoreA; B.ga += m.scoreH;
        if (m.scoreH > m.scoreA) { A.w++; A.pts += 3; B.l++; }
        else if (m.scoreA > m.scoreH) { B.w++; B.pts += 3; A.l++; }
        else { A.d++; B.d++; A.pts++; B.pts++; }
      }
      const order = Object.values(stat).sort((a, b) =>
        b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf ||
        curIdx[a.name] - curIdx[b.name]);
      order.forEach((r, i) => { r.idx = i + 1; });
      groups[letter] = order;
      thirds.push(order[2]);
    }
    thirds.sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);

    return { fetchedAt: snap.fetchedAt, matches, groups, thirdTable: thirds };
  }

  // Points + rank per gameday for the given labels (ranks vs the whole field).
  function computeHistory(snap, entries, scoring, wantedLabels) {
    const days = gamedays(snap);
    const series = wantedLabels.map(l => ({ label: l, points: [], ranks: [] }));
    for (const day of days) {
      const snapD = snapshotAsOf(snap, day);
      const base = {};
      for (const name of Object.keys(WC.TEAMS)) {
        base[name] = WCScoring.scoreTeam(name, snapD, scoring, { countLiveGoals: false }).basePoints;
      }
      const totals = entries.map(e => e.picks.reduce((s, p) =>
        s + base[p.name] * (WC.DOUBLE_TIERS.has(p.tier) ? 2 : 1), 0));
      for (const s of series) {
        const i = entries.findIndex(e => e.label === s.label);
        if (i < 0) continue;
        const t = totals[i];
        s.points.push(t);
        s.ranks.push(1 + totals.filter(x => x > t).length);
      }
    }
    return { days, series, fieldSize: entries.length };
  }

  window.WCHistory = { computeHistory, gamedays };
})();
