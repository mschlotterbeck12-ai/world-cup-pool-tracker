// App glue: load data, score my entry, run the simulation, render everything.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const SETTINGS_KEY = "wcpool.settings";

  let snap = null;
  let settings = loadSettings();
  let simResult = null;
  let view = WC.MY_LABEL;   // which entry the dashboard is showing

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { /* ignore */ }
    const merged = { ...WC.DEFAULT_SETTINGS, ...s };
    merged.scoring = { ...WC.DEFAULT_SCORING, ...(s.scoring || {}) };
    if (!merged.rivalsText) merged.rivalsText = WC.DEFAULT_SETTINGS.rivalsText;
    merged.rivalsText = merged.rivalsText.replace(/^Brother:/m, "Evan:");
    return merged;
  }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

  // ---- rival entry parsing: "Dan: France, Brazil, Germany, ..." one per line ----
  function parseRivals(text) {
    const rivals = [], errors = [];
    for (const line of (text || "").split("\n")) {
      if (!line.trim()) continue;
      const ci = line.indexOf(":");
      const label = ci > 0 ? line.slice(0, ci).trim() : "Rival";
      const teamsRaw = (ci > 0 ? line.slice(ci + 1) : line).split(",").map(t => t.trim()).filter(Boolean);
      const picks = [];
      for (const raw of teamsRaw) {
        const name = canonicalTeam(raw);
        if (!name) { errors.push(`${label}: unknown team "${raw}"`); continue; }
        const tier = +Object.entries(WC.TIERS).find(([, ts]) => ts.includes(name))[0];
        picks.push({ tier, name });
      }
      if (picks.length === 12) rivals.push({ label, picks });
      else if (picks.length) errors.push(`${label}: has ${picks.length} valid teams (needs 12)`);
    }
    return { rivals, errors };
  }
  function canonicalTeam(raw) {
    const k = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (WC.ALIASES[k]) return WC.ALIASES[k];
    for (const name of Object.keys(WC.TEAMS)) if (name.toLowerCase() === k) return name;
    for (const name of Object.keys(WC.TEAMS)) if (name.toLowerCase().startsWith(k) && k.length >= 4) return name;
    return null;
  }

  // ---------- rendering ----------
  const fmtPct = (p) => p >= 0.995 ? "100%" : p < 0.005 && p > 0 ? "<1%" : Math.round(p * 100) + "%";
  const fmtTime = (utc) => new Date(utc).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // The real field: entries baked from Dan's sheet (data/entries.js), with "Me"
  // first, plus any extra entries typed into Settings (sheet duplicates skipped).
  function baseEntries() {
    const { rivals } = parseRivals(settings.rivalsText);
    let list;
    if (window.WC_POOL_ENTRIES && window.WC_POOL_ENTRIES.length) {
      list = window.WC_POOL_ENTRIES.map(e => ({
        label: e.name === WC.MY_ENTRY_NAME ? WC.MY_LABEL : (WC.ENTRY_LABELS[e.name] || e.name),
        picks: e.teams.map((t, i) => ({ tier: i + 1, name: t })),
      }));
      const me = list.findIndex(e => e.label === WC.MY_LABEL);
      if (me > 0) list.unshift(list.splice(me, 1)[0]);
      else if (me < 0) list.unshift({ label: WC.MY_LABEL, picks: WC.MY_PICKS });
    } else {
      list = [{ label: WC.MY_LABEL, picks: WC.MY_PICKS }];
    }
    const sig = (picks) => picks.map(p => p.name).join("|");
    const have = new Set(list.map(e => sig(e.picks)));
    for (const r of rivals) {
      if (!have.has(sig(r.picks))) { list.push({ label: r.label, picks: r.picks }); have.add(sig(r.picks)); }
    }
    return list;
  }

  // All real entries, scored against current data.
  function scoredEntries() {
    return baseEntries().map(e =>
      ({ ...e, entry: WCScoring.scoreEntry(e.picks, snap, settings.scoring, settings) }));
  }
  function simEntrant(label) {
    return simResult && simResult.entrants ? simResult.entrants.find(e => e.label === label) : null;
  }

  function render() {
    const entries = scoredEntries();
    const cur = entries.find(e => e.label === view) || entries[0];
    view = cur.label;
    const possessive = `${cur.label}'s`;
    $("#teamsTitle").textContent = `${possessive} teams`;
    $("#ptsLabel").textContent = `${possessive} points`;
    renderHeader(cur);
    renderLive(cur);
    renderLeaderboard(entries);
    renderPicks(cur.entry);
    renderGroups(cur);
    renderSchedule(cur);
    renderFamChart();
    renderKeys();
    renderPath();
    $("#fetchedAt").textContent = "Data: " + new Date(snap.fetchedAt).toLocaleString();
  }

  function pickNames(cur) { return new Set(cur.picks.map(p => p.name)); }

  function renderHeader(cur) {
    $("#totalPts").textContent = cur.entry.total;
    const live = cur.entry.teams.some(t => t.liveGoals > 0);
    $("#totalLiveBadge").style.display = live ? "" : "none";
    const ent = simEntrant(cur.label);
    if (ent) {
      $("#pWin").textContent = fmtPct(ent.pWin);
      $("#pTop3").textContent = fmtPct(ent.pTop3);
      $("#projPts").textContent = Math.round(ent.p50);
      $("#projRange").textContent = `${Math.round(ent.p10)}–${Math.round(ent.p90)}`;
      $("#winningMedian").textContent = Math.round(simResult.winningMedian);
      $("#fieldNote").textContent = `field: ${simResult.entrants.length} real entries` +
        (simResult.nRandom ? ` + ${simResult.nRandom} simulated` : "") +
        ` · ${simResult.n.toLocaleString()} sims`;
    }
  }

  function renderLive(cur) {
    const now = Date.now();
    const myNames = pickNames(cur);
    const todays = snap.matches.filter(m => {
      if (!m.utc || m.cancelled) return false;
      const t = new Date(m.utc).getTime();
      const sameDay = new Date(m.utc).toDateString() === new Date().toDateString();
      const live = m.started && !m.finished;
      return (live || (sameDay && !m.finished) || (m.finished && now - t < 12 * 3600e3)) &&
             (myNames.has(m.homeName) || myNames.has(m.awayName));
    }).sort((a, b) => (a.utc || "").localeCompare(b.utc || ""));
    const el = $("#liveStrip");
    if (!todays.length) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = todays.map(m => {
      const live = m.started && !m.finished;
      const score = m.scoreH != null ? `${m.scoreH}–${m.scoreA}` : fmtTime(m.utc);
      const cls = live ? "live" : m.finished ? "done" : "upcoming";
      return `<div class="livecard ${cls}">
        <span>${flag(m.homeName)} ${m.homeName}</span>
        <strong>${score}</strong>
        <span>${m.awayName} ${flag(m.awayName)}</span>
        ${live ? '<span class="pulse">LIVE</span>' : m.finished ? '<span class="ft">FT</span>' : ""}
      </div>`;
    }).join("");
  }

  function flag(name) { return (WC.TEAMS[name] || {}).flag || ""; }

  // ---- pool leaderboard: me + every real rival entry, scored live ----
  // Rows are clickable: clicking switches the whole dashboard to that entry.
  function renderLeaderboard(entries) {
    const el = $("#leaderboard");
    if (entries.length < 2) { el.parentElement.style.display = "none"; return; }
    el.parentElement.style.display = "";
    const rows = entries.slice().sort((a, b) => b.entry.total - a.entry.total);
    // competition ranking: tied scores share the same rank
    const ranks = [];
    rows.forEach((r, i) => {
      ranks[i] = i > 0 && r.entry.total === rows[i - 1].entry.total ? ranks[i - 1] : i + 1;
    });
    const myRank = ranks[rows.findIndex(r => r.label === view)];
    $("#myRank").textContent = `#${myRank}`;
    $("#myRankOf").textContent = `of ${rows.length} entries`;
    const rowHtml = (r, rank) => {
      const sim = simEntrant(r.label);
      const flags = r.entry.teams.map(t =>
        `<span class="lbflag ${t.eliminated ? "out" : ""}" title="T${t.tier} ${t.team}: ${t.total} pts${t.eliminated ? " (eliminated)" : ""}">${flag(t.team)}</span>`
      ).join("");
      return `<tr data-label="${r.label}" class="${r.label === view ? "viewing" : ""}">
        <td>${rank}</td><td><strong>${r.label}</strong>${r.label === view ? ' <span class="viewtag">viewing</span>' : ""}</td>
        <td class="lbpts">${r.entry.total}</td>
        <td>${sim ? Math.round(sim.mean) : "–"}</td>
        <td>${sim ? fmtPct(sim.pWin) : "–"}</td>
        <td>${sim ? fmtPct(sim.pTop3) : "–"}</td>
        <td class="lbflags">${flags}</td>
      </tr>`;
    };
    const head = `<thead><tr>
        <th>#</th><th>Entry</th><th>Points</th><th>Projected</th><th>Win</th><th>Top 3</th><th>Teams</th>
      </tr></thead>`;
    // Family mini-board pinned above the full pool (rank = overall pool rank)
    const familyLabels = new Set([WC.MY_LABEL, ...Object.values(WC.ENTRY_LABELS)]);
    const famRows = rows.map((r, i) => ({ r, rank: ranks[i] })).filter(x => familyLabels.has(x.r.label));
    const famHtml = famRows.length > 1
      ? `<h3 class="lbsub">Family</h3><div class="lbfam"><table class="lbtable">${head}<tbody>` +
        famRows.map(x => rowHtml(x.r, x.rank)).join("") + `</tbody></table></div>
        <h3 class="lbsub">Full pool</h3>`
      : "";
    el.innerHTML = famHtml +
      `<div class="lbwrap"><table class="lbtable">${head}<tbody>` +
      rows.map((r, i) => rowHtml(r, ranks[i])).join("") + "</tbody></table></div>";
    el.querySelectorAll("tr[data-label]").forEach(tr => {
      tr.addEventListener("click", () => {
        view = tr.dataset.label;
        render();
      });
    });
  }

  // How many pool entries picked each country (memoized per data load).
  let ownershipCache = null;
  function ownership() {
    if (ownershipCache) return ownershipCache;
    const counts = {};
    const all = baseEntries();
    for (const e of all) for (const p of e.picks) counts[p.name] = (counts[p.name] || 0) + 1;
    ownershipCache = { counts, total: all.length };
    return ownershipCache;
  }

  function renderPicks(entry) {
    const grid = $("#picksGrid");
    const own = ownership();
    grid.innerHTML = entry.teams.map(t => {
      const sim = simResult ? simResult.teams[t.team] : null;
      const dbl = WC.DOUBLE_TIERS.has(t.tier);
      const goalsPts = (t.goals + t.liveGoals) * settings.scoring.goal;
      const owned = own.counts[t.team] || 0;
      const ownPct = Math.round((owned / own.total) * 100);
      const chips = [
        `⚽ ${t.goals + t.liveGoals} goal${t.goals + t.liveGoals === 1 ? "" : "s"} (${goalsPts * t.multiplier})`,
        `${t.wins}W ${t.draws}D ${t.losses}L (${t.groupResultPts * t.multiplier})`,
        `👥 ${owned}/${own.total} picked (${ownPct}%)`,
      ];
      if (t.finishBonus) chips.push(`Group bonus (${t.finishBonus * t.multiplier})`);
      if (t.finishPending) chips.push(`3rd — best-3rd TBD`);
      if (t.knockoutBonus) chips.push(`Knockout (${t.knockoutBonus * t.multiplier})`);
      const simRow = sim ? `
        <div class="simrow">
          <span title="chance to advance from group">Adv ${fmtPct(sim.advance)}</span>
          <span title="chance to reach quarter-finals">QF ${fmtPct(sim.QF)}</span>
          <span title="chance to win the World Cup">🏆 ${fmtPct(sim.champion)}</span>
          <span title="expected final pool points from this team">xPts ${sim.xPts.toFixed(0)}</span>
        </div>` : "";
      const next = t.nextMatch ? `<div class="next">Next: ${opponentLine(t)} · ${fmtTime(t.nextMatch.utc)}</div>`
        : t.eliminated ? "" : "<div class='next'>No fixture scheduled yet</div>";
      const notes = t.notes.length ? `<div class="warn">⚠️ ${t.notes.join("; ")}</div>` : "";
      return `<div class="card ${t.eliminated ? "eliminated" : ""} ${t.liveGoals ? "live-glow" : ""}">
        <div class="cardtop">
          <span class="flag">${flag(t.team)}</span>
          <div class="nameblock"><strong>${t.team}</strong>
            <span class="meta">Tier ${t.tier}${dbl ? ' <em class="dbl">2×</em>' : ""} · Group ${WC.TEAMS[t.team].group}</span>
          </div>
          <div class="pts">${t.total}<span class="ptslabel">pts</span></div>
        </div>
        <div class="status">${t.status}${t.liveGoals ? ' <span class="pulse">LIVE</span>' : ""}</div>
        <div class="chips">${chips.map(c => `<span class="chip">${c}</span>`).join("")}</div>
        ${simRow}${next}${notes}
      </div>`;
    }).join("");
  }

  function opponentLine(t) {
    const m = t.nextMatch;
    const opp = m.homeName === t.team ? m.awayName : m.homeName;
    return `vs ${flag(opp)} ${opp}`;
  }

  function renderGroups(cur) {
    const myNames = pickNames(cur);
    const el = $("#groupsGrid");
    el.innerHTML = Object.entries(snap.groups).map(([letter, rows]) => {
      const hasPick = rows.some(r => myNames.has(r.name));
      const body = rows.slice().sort((a, b) => a.idx - b.idx).map(r => `
        <tr class="${myNames.has(r.name) ? "mine" : ""}">
          <td>${r.idx}</td><td>${flag(r.name)} ${r.name}</td>
          <td>${r.played}</td><td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td><td><strong>${r.pts}</strong></td>
        </tr>`).join("");
      return `<div class="grouptable ${hasPick ? "" : "nopick"}">
        <h4>Group ${letter}${hasPick ? "" : " <span class='nopicktag'>no pick</span>"}</h4>
        <table><thead><tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${body}</tbody></table>
      </div>`;
    }).join("");
    // best thirds table
    const tt = $("#thirdTable");
    if (snap.thirdTable && snap.thirdTable.length) {
      tt.innerHTML = "<h4>Best 3rd-placed teams (top 8 advance)</h4><table><tbody>" +
        snap.thirdTable.map((r, i) => `<tr class="${i < 8 ? "qual" : "out"} ${myNames.has(r.name) ? "mine" : ""}">
          <td>${i + 1}</td><td>${flag(r.name)} ${r.name}</td><td>${r.pts} pts</td><td>GD ${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td></tr>`).join("") +
        "</tbody></table>";
    } else tt.innerHTML = "";
  }

  function renderSchedule(cur) {
    const myNames = pickNames(cur);
    const ms = snap.matches.filter(m => myNames.has(m.homeName) || myNames.has(m.awayName))
      .sort((a, b) => (a.utc || "").localeCompare(b.utc || ""));
    const byDay = {};
    for (const m of ms) {
      const day = m.utc ? new Date(m.utc).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : "TBD";
      (byDay[day] = byDay[day] || []).push(m);
    }
    $("#schedule").innerHTML = Object.entries(byDay).map(([day, list]) => `
      <div class="schedday"><h4>${day}</h4>${list.map(m => {
        const live = m.started && !m.finished;
        const score = m.scoreH != null ? `${m.scoreH}–${m.scoreA}` : new Date(m.utc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const roundTag = m.group ? `Grp ${m.group}` : (WC.ROUND_LABEL[WC.ROUND_OF[m.round]] || m.round);
        return `<div class="schedrow ${live ? "live" : m.finished ? "done" : ""}">
          <span class="round">${roundTag}</span>
          <span class="t ${myNames.has(m.homeName) ? "mine" : ""}">${flag(m.homeName)} ${m.homeName}</span>
          <strong>${score}</strong>
          <span class="t ${myNames.has(m.awayName) ? "mine" : ""}">${m.awayName} ${flag(m.awayName)}</span>
          ${live ? '<span class="pulse">LIVE</span>' : ""}
        </div>`;
      }).join("")}</div>`).join("");
  }

  // ---- family race chart: points or pool rank per gameday ----
  const FAM_PALETTE = ["#60a5fa", "#fbbf24", "#f472b6", "#c084fc"];
  let historyCache = { key: null, data: null };

  function familyLabels() {
    return baseEntries().map(e => e.label)
      .filter(l => l === WC.MY_LABEL || Object.values(WC.ENTRY_LABELS).includes(l));
  }

  function familyHistory() {
    const key = snap.fetchedAt + "|" + JSON.stringify(settings.scoring);
    if (historyCache.key === key) return historyCache.data;
    const data = WCHistory.computeHistory(snap, scoredEntries(), settings.scoring, familyLabels());
    historyCache = { key, data };
    return data;
  }

  function famColor(label, i) { return label === WC.MY_LABEL ? "#4ade80" : FAM_PALETTE[i % FAM_PALETTE.length]; }

  // ---- "Keys to winning" analysis per family member ----
  let keysView = WC.MY_LABEL;

  function renderKeys() {
    const sec = $("#keysSection");
    const fam = familyLabels();
    if (!simResult || !simResult.keys || fam.length < 2) { sec.style.display = "none"; return; }
    sec.style.display = "";
    if (!fam.includes(keysView)) keysView = fam[0];
    $("#keysSeg").innerHTML = fam.map(l =>
      `<button data-keys="${l}" class="${l === keysView ? "active" : ""}">${l}</button>`).join("");
    $("#keysSeg").querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => { keysView = b.dataset.keys; renderKeys(); }));

    const entries = scoredEntries();
    const e = entries.find(x => x.label === keysView);
    const ent = simEntrant(keysView);
    const keys = simResult.keys[keysView] || [];
    const own = {};
    for (const be of entries) for (const p of be.picks) own[p.name] = (own[p.name] || 0) + 1;
    const nEntries = entries.length;
    const byTeam = {};
    for (const t of e.entry.teams) byTeam[t.team] = t;

    const milestoneText = (tier) => tier >= 9 ? "advance from the group (2× bonus)"
      : tier >= 5 ? "reach the quarter-finals" : "reach the semi-finals";

    const summary = ent ? `<div class="keysummary">
        <span class="chip">${e.entry.total} pts now</span>
        <span class="chip">projected ${Math.round(ent.p50)}</span>
        <span class="chip">win ${fmtPct(ent.pWin)}</span>
        <span class="chip">top 3 ${fmtPct(ent.pTop3)}</span>
        <span class="chip">typical winning score ${Math.round(simResult.winningMedian)}</span>
      </div>` : "";

    const alive = keys.filter(k => byTeam[k.team] && !byTeam[k.team].eliminated)
      .sort((a, b) => b.delta - a.delta).slice(0, 5);
    const rows = alive.map((k, i) => {
      const o = own[k.team] || 0;
      const lev = o <= nEntries * 0.1 ? `only ${o}/${nEntries} entries have them — pure separation`
        : o >= nEntries * 0.5 ? `${o}/${nEntries} entries share this pick — little separation`
        : `owned by ${o}/${nEntries} entries`;
      return `<div class="keyrow">
        <span class="keynum">${i + 1}</span>
        <span class="flag">${flag(k.team)}</span>
        <div class="keybody">
          <strong>${k.team}</strong> <span class="meta">Tier ${k.tier}${WC.DOUBLE_TIERS.has(k.tier) ? ' · <em class="dbl">2×</em>' : ""}</span>
          <div class="keytext">If they ${milestoneText(k.tier)}: top-3 odds ${fmtPct(k.pTop3IfNo)} → <strong class="up">${fmtPct(k.pTop3IfYes)}</strong>
            <span class="keymeta">· ${fmtPct(k.pCond)} likely · ${lev}</span></div>
        </div>
      </div>`;
    }).join("");

    const dead = e.entry.teams.filter(t => t.eliminated);
    const deadNote = dead.length
      ? `<div class="keynote">💀 Already eliminated: ${dead.map(t => `${flag(t.team)} ${t.team}`).join(", ")} — that upside is gone.</div>`
      : "";
    $("#keysContent").innerHTML = summary + rows + deadNote;
  }

  // ---- "Path to victory": gated until the bracket is set, then concrete scenarios ----
  let pathView = WC.MY_LABEL;
  const KO_ORDER = ["R32", "R16", "QF", "SF", "FINAL"];
  const KO_LABEL = { R32: "Round of 32", R16: "Round of 16", QF: "quarter-finals", SF: "semi-finals", FINAL: "the final" };

  function groupStageDone() {
    const g = snap.matches.filter(m => m.group);
    return g.length > 0 && g.every(m => m.finished);
  }

  function renderPath() {
    const sec = $("#pathSection");
    const fam = familyLabels();
    if (fam.length < 2) { sec.style.display = "none"; return; }
    sec.style.display = "";
    if (!fam.includes(pathView)) pathView = fam[0];
    $("#pathSeg").innerHTML = fam.map(l =>
      `<button data-path="${l}" class="${l === pathView ? "active" : ""}">${l}</button>`).join("");
    $("#pathSeg").querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => { pathView = b.dataset.path; renderPath(); }));

    // Locked until every group match is played (all knockout spots secured)
    if (!groupStageDone() || !simResult) {
      const left = snap.matches.filter(m => m.group && !m.finished).length;
      $("#pathContent").innerHTML = `<div class="comingsoon">
        <div class="cslock">🔒</div>
        <div class="cstitle">Coming soon</div>
        <p>Your path to the win unlocks once <strong>all knockout spots are locked in</strong> — i.e. the group stage is complete and the Round of 32 is set.</p>
        <p class="csmeta">${left > 0 ? `${left} group ${left === 1 ? "match" : "matches"} still to play.` : "Finalizing the bracket…"} Then this fills in with exactly what your teams need to do, and updates as teams get knocked out.</p>
      </div>`;
      return;
    }

    const entries = scoredEntries();
    const rows = entries.slice().sort((a, b) => b.entry.total - a.entry.total);
    const ranks = [];
    rows.forEach((r, i) => { ranks[i] = i > 0 && r.entry.total === rows[i - 1].entry.total ? ranks[i - 1] : i + 1; });
    const myIdx = rows.findIndex(r => r.label === pathView);
    const me = rows[myIdx];
    const myRank = ranks[myIdx];
    const ent = simEntrant(pathView);
    const cash = Math.round(simResult.cashMedian);
    const winScore = Math.round(simResult.winningMedian);
    const toPassCash = Math.max(0, myRank - 3);
    const toPassWin = Math.max(0, myRank - 1);

    const verdict = ent.pTop3 >= 0.5 ? "You're in a commanding spot."
      : ent.pTop3 >= 0.15 ? "You're live for the cash."
      : ent.pTop3 >= 0.03 ? "It's a long shot, but the path exists." : "You need chaos to break your way.";

    const summary = `<div class="pathhead">
      <div class="pathverdict">${verdict}</div>
      <div class="keysummary">
        <span class="chip">#${myRank} now · ${me.entry.total} pts</span>
        <span class="chip">projected ${Math.round(ent.p50)}</span>
        <span class="chip">win ${fmtPct(ent.pWin)}</span>
        <span class="chip">top 3 ${fmtPct(ent.pTop3)}</span>
      </div>
      <div class="pathtargets">
        <div class="ptcard"><div class="ptbig">${cash}</div><div class="ptlbl">typical cash line (3rd)</div>
          <div class="ptsub">${me.entry.total >= cash ? "you're already above it" : `~${cash - me.entry.total} pts above your current total`}</div></div>
        <div class="ptcard"><div class="ptbig">${winScore}</div><div class="ptlbl">typical winning score</div>
          <div class="ptsub">${me.entry.total >= winScore ? "you're already above it" : `~${winScore - me.entry.total} pts above your current total`}</div></div>
        <div class="ptcard"><div class="ptbig">${toPassCash}</div><div class="ptlbl">entries to pass for top 3</div>
          <div class="ptsub">${toPassWin} to pass for 1st</div></div>
      </div>
    </div>`;

    // Per surviving team: the next knockout milestone it can still reach + ceiling
    const alive = me.entry.teams.filter(t => !t.eliminated);
    const deepest = (t) => { let d = -1; KO_ORDER.forEach((k, i) => { if (t.reached[k]) d = i; }); return d; };
    const reachPts = { R16: settings.scoring.reachR16, QF: settings.scoring.reachQF, SF: settings.scoring.reachSF, FINAL: settings.scoring.reachFinal };
    const scen = alive.map(t => {
      const sim = simResult.teams[t.team] || {};
      const d = Math.max(0, deepest(t));  // groups done ⇒ survivors are at least in the R32
      const nextKey = KO_ORDER[d + 1];   // undefined if already in final
      const nextP = nextKey ? sim[nextKey === "R32" ? "R16" : nextKey] : null;
      const champP = sim.champion || 0;
      const mult = t.multiplier;
      const nextPts = nextKey && reachPts[nextKey] ? reachPts[nextKey] * mult : 0;
      return { t, sim, nextKey, nextP, champP, nextPts, score: (nextP || 0) * nextPts + champP * 20 * mult };
    }).sort((a, b) => b.score - a.score);

    const scenRows = scen.map(s => {
      const t = s.t;
      const cur = KO_ORDER[deepest(t)] || "group";
      const curLabel = cur === "FINAL" ? "in the final" : cur === "group" ? "into the knockouts" : `in the ${KO_LABEL[cur]}`;
      const need = s.nextKey
        ? `needs to reach <strong>${KO_LABEL[s.nextKey]}</strong> — ${fmtPct(s.nextP)} likely <span class="keymeta">(+${s.nextPts} pts${t.multiplier > 1 ? ", 2×" : ""})</span>`
        : `is in the final — win it for the title <span class="keymeta">(${fmtPct(s.champP)} champion)</span>`;
      const ceiling = s.champP > 0.005 ? ` · 🏆 ${fmtPct(s.champP)}` : "";
      return `<div class="keyrow">
        <span class="flag">${flag(t.team)}</span>
        <div class="keybody">
          <strong>${t.team}</strong> <span class="meta">Tier ${t.tier}${t.multiplier > 1 ? ' · <em class="dbl">2×</em>' : ""} · ${curLabel}</span>
          <div class="keytext">${need}${ceiling}</div>
        </div>
      </div>`;
    }).join("");

    const dead = me.entry.teams.filter(t => t.eliminated);
    const deadNote = dead.length
      ? `<div class="keynote">💀 Out: ${dead.map(t => `${flag(t.team)} ${t.team}`).join(", ")} — those points are locked.</div>`
      : "";
    $("#pathContent").innerHTML = summary +
      `<h3 class="lbsub">What your live teams need to do</h3>` + (scenRows || "<p class='csmeta'>All your teams are eliminated.</p>") + deadNote;
  }

  let famMode = "points";   // "points" | "rank"

  function setFamMode(mode) {
    famMode = mode;
    $("#famModePoints").classList.toggle("active", mode === "points");
    $("#famModeRank").classList.toggle("active", mode === "rank");
    renderFamChart();
  }

  function renderFamChart() {
    const sec = $("#famChartSection");
    const hist = familyHistory();
    if (!hist.days.length || hist.series.length < 2) { sec.style.display = "none"; return; }
    sec.style.display = "";
    const isRank = famMode === "rank";
    $("#famChartNote").textContent = isRank
      ? `pool rank by gameday · #1 = leading all ${hist.fieldSize} entries`
      : "total points by gameday";
    let pi = 0;
    const colors = hist.series.map(s => s.label === WC.MY_LABEL ? famColor(s.label) : famColor(s.label, pi++));
    $("#famLegend").innerHTML = hist.series.map((s, i) =>
      `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${s.label}</span>`
    ).join("");

    const cv = $("#famChart"), ctx = cv.getContext("2d");
    const dpr = devicePixelRatio || 1;
    const W = cv.width = cv.clientWidth * dpr;
    const H = cv.height = 280 * dpr;
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue("--muted").trim() || "#8896b3";
    const line = css.getPropertyValue("--line").trim() || "#233354";
    const padL = 50 * dpr, padR = 56 * dpr, padT = 16 * dpr, padB = 30 * dpr;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = hist.days.length;
    const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

    // one metric, one axis
    const series = hist.series.map(s => isRank ? s.ranks : s.points);
    let yFn, ticks;
    if (isRank) {
      const maxRank = hist.fieldSize;
      yFn = (r) => padT + ((r - 1) / (maxRank - 1)) * plotH;
      ticks = [1, Math.round(maxRank / 4), Math.round(maxRank / 2),
        Math.round(3 * maxRank / 4), maxRank].map(r => ({ v: r, label: "#" + r }));
    } else {
      const maxPts = Math.max(10, ...series.flat());
      const top = Math.ceil(maxPts * 1.15 / 10) * 10;
      yFn = (v) => padT + plotH - (v / top) * plotH;
      const steps = 5;
      ticks = Array.from({ length: steps + 1 },
        (_, g) => ({ v: top / steps * g, label: String(Math.round(top / steps * g)) }));
    }

    ctx.font = `${11 * dpr}px -apple-system, sans-serif`;
    for (const t of ticks) {
      const y = yFn(t.v);
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = "right";
      ctx.fillText(t.label, padL - 8 * dpr, y + 4 * dpr);
    }
    // x labels (thinned)
    const every = Math.max(1, Math.ceil(n / 9));
    ctx.textAlign = "center"; ctx.fillStyle = muted;
    hist.days.forEach((d, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      const dt = new Date(d + "T12:00:00Z");
      ctx.fillText(dt.toLocaleDateString([], { month: "short", day: "numeric" }), x(i), H - 8 * dpr);
    });

    // tiny per-person vertical offset so identical lines (shared picks) stay visible
    const off = (i) => (i - (hist.series.length - 1) / 2) * 2.4 * dpr;
    series.forEach((vals, i) => {
      ctx.strokeStyle = colors[i]; ctx.lineWidth = 2.6 * dpr;
      ctx.beginPath();
      vals.forEach((v, k) => { const X = x(k), Y = yFn(v) + off(i); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
      ctx.fillStyle = colors[i];
      vals.forEach((v, k) => { ctx.beginPath(); ctx.arc(x(k), yFn(v) + off(i), 3 * dpr, 0, 7); ctx.fill(); });
    });
    // end-of-line value labels, nudged apart if overlapping
    const ends = series.map((vals, i) => ({ y: yFn(vals[n - 1]), v: vals[n - 1], c: colors[i] }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 14 * dpr) ends[i].y = ends[i - 1].y + 14 * dpr;
    }
    ctx.textAlign = "left"; ctx.font = `bold ${12 * dpr}px -apple-system, sans-serif`;
    for (const e of ends) {
      ctx.fillStyle = e.c;
      ctx.fillText(isRank ? "#" + e.v : String(e.v), x(n - 1) + 8 * dpr, e.y + 4 * dpr);
    }
  }

  // ---------- simulation ----------
  function runSim() {
    const { errors } = parseRivals(settings.rivalsText);
    if (errors.length) console.warn("rival parse:", errors);
    $("#simStatus").textContent = "Simulating…";
    WCSim.run(snap, { ...settings, keyLabels: familyLabels() }, baseEntries(),
      (p) => { $("#simStatus").textContent = `Simulating… ${Math.round(p * 100)}%`; },
      (res) => {
        simResult = res;
        $("#simStatus").textContent = "";
        render();
      });
  }

  // ---------- refresh ----------
  async function doRefresh(auto) {
    const btn = $("#refreshBtn");
    btn.disabled = true; btn.textContent = "Refreshing…";
    try {
      snap = await WCData.refresh();
      render();
      runSim();
    } catch (e) {
      if (!auto) $("#fetchedAt").textContent = "Live refresh failed (FotMob/proxy unreachable) — run ./update.sh and reload";
    } finally {
      btn.disabled = false; btn.textContent = "↻ Refresh";
    }
  }

  function autoRefreshLoop() {
    const anyLive = snap.matches.some(m => m.started && !m.finished);
    const next = snap.matches.filter(m => !m.finished && m.utc && !m.cancelled)
      .map(m => new Date(m.utc).getTime()).sort()[0];
    const soon = next && next - Date.now() < 10 * 60e3;
    if (anyLive || soon) doRefresh(true);
    setTimeout(autoRefreshLoop, anyLive ? 90e3 : 5 * 60e3);
  }

  // ---------- settings dialog ----------
  function openSettings() {
    $("#setFieldSize").value = settings.fieldSize;
    $("#setSims").value = settings.nSims;
    $("#setHostBoost").value = settings.hostBoost;
    $("#setLiveGoals").checked = settings.countLiveGoals;
    $("#setScoring").value = JSON.stringify(settings.scoring, null, 2);
    $("#setRivals").value = settings.rivalsText;
    $("#settingsErr").textContent = "";
    $("#settingsDlg").showModal();
  }
  function saveSettingsFromDlg() {
    try {
      const scoring = JSON.parse($("#setScoring").value);
      const { errors } = parseRivals($("#setRivals").value);
      if (errors.length) { $("#settingsErr").textContent = errors.join(" · "); return; }
      settings.fieldSize = Math.max(2, parseInt($("#setFieldSize").value, 10) || 20);
      settings.nSims = Math.min(20000, Math.max(200, parseInt($("#setSims").value, 10) || 2000));
      settings.hostBoost = parseInt($("#setHostBoost").value, 10) || 0;
      settings.countLiveGoals = $("#setLiveGoals").checked;
      settings.scoring = { ...WC.DEFAULT_SCORING, ...scoring };
      settings.rivalsText = $("#setRivals").value;
      saveSettings();
      ownershipCache = null;   // rivals may have changed
      $("#settingsDlg").close();
      render();
      runSim();
    } catch (e) {
      $("#settingsErr").textContent = "Scoring JSON invalid: " + e.message;
    }
  }

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    snap = WCData.loadInitial();
    if (!snap) {
      document.body.innerHTML = "<p style='padding:2rem'>No data. Run <code>./update.sh</code> first.</p>";
      return;
    }
    render();
    runSim();
    $("#refreshBtn").addEventListener("click", () => doRefresh(false));
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#famModePoints").addEventListener("click", () => setFamMode("points"));
    $("#famModeRank").addEventListener("click", () => setFamMode("rank"));
    $("#settingsSave").addEventListener("click", (e) => { e.preventDefault(); saveSettingsFromDlg(); });
    $("#settingsCancel").addEventListener("click", (e) => { e.preventDefault(); $("#settingsDlg").close(); });
    window.addEventListener("resize", () => { renderFamChart(); });
    doRefresh(true);          // try to get fresher data than the baked snapshot
    setTimeout(autoRefreshLoop, 60e3);
  });
})();
