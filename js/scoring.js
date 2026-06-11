// Scoring engine: computes actual (banked + live-provisional) pool points from FotMob data.
(function () {
  const KO_ROUNDS = ["1/16", "1/8", "1/4", "1/2", "bronze", "final"];

  function isGroupRound(m) { return !!m.group; }

  function isRealTeam(name) { return name in WC.TEAMS; }

  // Winner of a finished knockout match. Tie score => decided on penalties; resolve
  // by which team appears in a later round (or bronze/final result chains).
  function winnerOf(match, allMatches) {
    if (!match.finished || match.scoreH == null) return null;
    if (match.scoreH > match.scoreA) return match.homeName;
    if (match.scoreA > match.scoreH) return match.awayName;
    // penalties — find a later-round match featuring one of the two
    const later = allMatches.filter(x =>
      KO_ROUNDS.indexOf(x.round) > KO_ROUNDS.indexOf(match.round) &&
      (x.homeName === match.homeName || x.awayName === match.homeName ||
       x.homeName === match.awayName || x.awayName === match.awayName));
    for (const x of later) {
      if (x.homeName === match.homeName || x.awayName === match.homeName) return match.homeName;
      if (x.homeName === match.awayName || x.awayName === match.awayName) return match.awayName;
    }
    return null; // unknown (e.g. final on pens before FotMob updates) — flag in UI
  }

  // Compute the full scoring breakdown for one team.
  function scoreTeam(teamName, data, scoring, opts) {
    const { matches, groups, thirdTable } = data;
    const group = WC.TEAMS[teamName].group;
    const b = {
      team: teamName,
      goals: 0, liveGoals: 0, wins: 0, draws: 0, losses: 0, groupResultPts: 0,
      groupRank: null, groupComplete: false, finishBonus: 0, finishPending: false,
      reached: {}, knockoutBonus: 0, champion: false, bronzeWinner: false,
      eliminated: false, alive: true, status: "", nextMatch: null, lastMatch: null,
      total: 0, multiplier: 1, notes: [],
    };

    const my = matches.filter(m => m.homeName === teamName || m.awayName === teamName);

    // Goals + group results
    for (const m of my) {
      if (m.scoreH == null) continue;
      const mine = m.homeName === teamName ? m.scoreH : m.scoreA;
      const theirs = m.homeName === teamName ? m.scoreA : m.scoreH;
      if (m.finished) {
        b.goals += mine;
        if (isGroupRound(m)) {
          if (mine > theirs) b.wins++;
          else if (mine === theirs) b.draws++;
          else b.losses++;
        }
      } else if (m.started && opts.countLiveGoals) {
        b.liveGoals += mine;
      }
    }
    b.groupResultPts = b.wins * scoring.groupWin + b.draws * scoring.groupDraw;

    // Group finish bonus (only once all 6 group matches are done)
    const groupMatches = matches.filter(m => m.group === group);
    b.groupComplete = groupMatches.length > 0 && groupMatches.every(m => m.finished);
    const row = (groups[group] || []).find(r => r.name === teamName);
    if (row) b.groupRank = row.idx;
    const allGroupsDone = matches.filter(isGroupRound).every(m => m.finished);
    const inR32 = matches.some(m => m.round === "1/16" &&
      (m.homeName === teamName || m.awayName === teamName));
    if (b.groupComplete && b.groupRank != null) {
      if (b.groupRank === 1) b.finishBonus = scoring.finish1st;
      else if (b.groupRank === 2) b.finishBonus = scoring.finish2nd;
      else if (b.groupRank === 3) {
        if (inR32) b.finishBonus = scoring.finish3rdAdvance;
        else if (allGroupsDone) {
          const pos = thirdTable.findIndex(r => r.name === teamName);
          if (pos >= 0 && pos < 8) b.finishBonus = scoring.finish3rdAdvance;
          else b.eliminated = true;
        } else {
          b.finishPending = true; // 3rd place, waiting on other groups
        }
      } else {
        b.eliminated = true;
      }
    }

    // Knockout progression: a team has "reached" a round when it appears in that
    // round's fixture with a real identity (FotMob fills entrants as soon as known).
    const reachKeys = [["1/16", "R32", scoring.reachR32], ["1/8", "R16", scoring.reachR16],
      ["1/4", "QF", scoring.reachQF], ["1/2", "SF", scoring.reachSF]];
    for (const [round, key, pts] of reachKeys) {
      if (matches.some(m => m.round === round && (m.homeName === teamName || m.awayName === teamName))) {
        b.reached[key] = true;
        b.knockoutBonus += pts;
      }
    }
    const finalMatch = matches.find(m => m.id === WC.FINAL_ID);
    const bronzeMatch = matches.find(m => m.id === WC.BRONZE_ID);
    if (finalMatch && (finalMatch.homeName === teamName || finalMatch.awayName === teamName)) {
      b.reached.FINAL = true;
      b.knockoutBonus += scoring.reachFinal;
      const w = winnerOf(finalMatch, matches);
      if (w === teamName) { b.champion = true; b.knockoutBonus += scoring.winFinal; }
      else if (finalMatch.finished && w == null) b.notes.push("Final on penalties — confirm winner manually");
    }
    if (bronzeMatch && (bronzeMatch.homeName === teamName || bronzeMatch.awayName === teamName)) {
      const w = winnerOf(bronzeMatch, matches);
      if (w === teamName) { b.bronzeWinner = true; b.knockoutBonus += scoring.winBronze; }
    }

    // Knockout elimination: lost a finished knockout match
    for (const m of my) {
      if (!isGroupRound(m) && m.finished) {
        const w = winnerOf(m, matches);
        if (w && w !== teamName && m.id !== WC.BRONZE_ID) b.eliminated = true;
      }
    }

    // Status + next/last match
    const future = my.filter(m => !m.finished && !m.cancelled && isRealTeam(m.homeName) && isRealTeam(m.awayName))
      .sort((x, y) => (x.utc || "").localeCompare(y.utc || ""));
    b.nextMatch = future[0] || null;
    const past = my.filter(m => m.finished).sort((x, y) => (y.utc || "").localeCompare(x.utc || ""));
    b.lastMatch = past[0] || null;
    b.alive = !b.eliminated;

    if (b.champion) b.status = "🏆 World Champions";
    else if (b.eliminated) b.status = "Eliminated";
    else if (Object.keys(b.reached).length) {
      const deepest = ["FINAL", "SF", "QF", "R16", "R32"].find(k => b.reached[k]);
      b.status = `Alive — ${WC.ROUND_LABEL[deepest]}`;
    } else if (b.groupComplete && b.finishPending) b.status = "3rd in group — awaiting best-3rd ranking";
    else b.status = `Group ${group}` + (b.groupRank ? ` — ${ordinal(b.groupRank)} place` : "");

    b.multiplier = 1; // caller applies tier doubling
    b.basePoints = (b.goals + b.liveGoals) * scoring.goal + b.groupResultPts + b.finishBonus + b.knockoutBonus;
    return b;
  }

  function ordinal(n) { return n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || "th"); }

  // Score a full entry (array of {tier, name}); returns {teams:[breakdown], total}
  function scoreEntry(picks, data, scoring, opts) {
    const teams = picks.map(p => {
      const b = scoreTeam(p.name, data, scoring, opts);
      b.tier = p.tier;
      b.multiplier = WC.DOUBLE_TIERS.has(p.tier) ? 2 : 1;
      b.total = b.basePoints * b.multiplier;
      return b;
    });
    return { teams, total: teams.reduce((s, t) => s + t.total, 0) };
  }

  window.WCScoring = { scoreEntry, scoreTeam, winnerOf, ordinal };
})();
