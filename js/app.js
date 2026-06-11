// App glue: load data, score my entry, run the simulation, render everything.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const SETTINGS_KEY = "wcpool.settings";

  let snap = null;
  let settings = loadSettings();
  let simResult = null;
  let view = "Me";   // which entry the dashboard is showing

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

  // All real entries (mine + parsed rivals), scored against current data.
  function scoredEntries() {
    const { rivals } = parseRivals(settings.rivalsText);
    return [
      { label: "Me", picks: WC.MY_PICKS },
      ...rivals.map(r => ({ label: r.label, picks: r.picks })),
    ].map(e => ({ ...e, entry: WCScoring.scoreEntry(e.picks, snap, settings.scoring, settings) }));
  }
  function simEntrant(label) {
    return simResult && simResult.entrants ? simResult.entrants.find(e => e.label === label) : null;
  }

  function render() {
    const entries = scoredEntries();
    const cur = entries.find(e => e.label === view) || entries[0];
    view = cur.label;
    const possessive = cur.label === "Me" ? "My" : `${cur.label}'s`;
    $("#teamsTitle").textContent = `${possessive} teams`;
    $("#histoWho").textContent = cur.label === "Me" ? "I" : cur.label;
    $("#ptsLabel").textContent = `${possessive.toLowerCase()} points`;
    renderHeader(cur);
    renderLive(cur);
    renderLeaderboard(entries);
    renderPicks(cur.entry);
    renderGroups(cur);
    renderSchedule(cur);
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
      $("#fieldNote").textContent = `vs ${settings.fieldSize - 1} rivals (${parseRivals(settings.rivalsText).rivals.length} real, rest simulated) · ${simResult.n.toLocaleString()} sims`;
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
    el.innerHTML = `<table class="lbtable"><thead><tr>
        <th>#</th><th>Entry</th><th>Points</th><th>Projected</th><th>Win</th><th>Top 3</th><th>Teams</th>
      </tr></thead><tbody>` +
      rows.map((r, i) => {
        const sim = simEntrant(r.label);
        const flags = r.entry.teams.map(t =>
          `<span class="lbflag ${t.eliminated ? "out" : ""}" title="T${t.tier} ${t.team}: ${t.total} pts${t.eliminated ? " (eliminated)" : ""}">${flag(t.team)}</span>`
        ).join("");
        return `<tr data-label="${r.label}" class="${r.label === view ? "viewing" : ""}">
          <td>${i + 1}</td><td><strong>${r.label}</strong>${r.label === view ? ' <span class="viewtag">viewing</span>' : ""}</td>
          <td class="lbpts">${r.entry.total}</td>
          <td>${sim ? Math.round(sim.mean) : "–"}</td>
          <td>${sim ? fmtPct(sim.pWin) : "–"}</td>
          <td>${sim ? fmtPct(sim.pTop3) : "–"}</td>
          <td class="lbflags">${flags}</td>
        </tr>`;
      }).join("") + "</tbody></table>";
    el.querySelectorAll("tr[data-label]").forEach(tr => {
      tr.addEventListener("click", () => {
        view = tr.dataset.label;
        render();
        renderHistogram();
      });
    });
  }

  function renderPicks(entry) {
    const grid = $("#picksGrid");
    grid.innerHTML = entry.teams.map(t => {
      const sim = simResult ? simResult.teams[t.team] : null;
      const dbl = WC.DOUBLE_TIERS.has(t.tier);
      const goalsPts = (t.goals + t.liveGoals) * settings.scoring.goal;
      const chips = [
        `⚽ ${t.goals + t.liveGoals} goal${t.goals + t.liveGoals === 1 ? "" : "s"} (${goalsPts * t.multiplier})`,
        `${t.wins}W ${t.draws}D ${t.losses}L (${t.groupResultPts * t.multiplier})`,
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

  function renderHistogram() {
    const ent = simEntrant(view);
    if (!ent) return;
    const cv = $("#histo"), ctx = cv.getContext("2d");
    const W = cv.width = cv.clientWidth * devicePixelRatio;
    const H = cv.height = 220 * devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    const totals = ent.totals;
    const min = totals[0], max = totals[totals.length - 1];
    const nb = 40, bins = new Array(nb).fill(0);
    for (const t of totals) bins[Math.min(nb - 1, Math.floor((t - min) / (max - min + 1e-9) * nb))]++;
    const bmax = Math.max(...bins);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--accent").trim() || "#4ade80";
    const bw = W / nb;
    bins.forEach((b, i) => {
      const h = (b / bmax) * (H - 40 * devicePixelRatio);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(i * bw + 1, H - h - 20 * devicePixelRatio, bw - 2, h);
    });
    ctx.globalAlpha = 1;
    // markers: median (mine) and median winning score
    const mark = (val, color, label, yOff) => {
      const x = ((val - min) / (max - min + 1e-9)) * W;
      ctx.strokeStyle = color; ctx.lineWidth = 2 * devicePixelRatio;
      ctx.setLineDash([6, 4]); ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, H - 20 * devicePixelRatio); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = `${12 * devicePixelRatio}px -apple-system, sans-serif`;
      ctx.textAlign = x > W * 0.8 ? "right" : "left";
      ctx.fillText(label, x + (x > W * 0.8 ? -6 : 6) * devicePixelRatio, (14 + yOff) * devicePixelRatio);
    };
    mark(ent.p50, css.getPropertyValue("--ink").trim() || "#fff", `${view === "Me" ? "my" : view + "'s"} median ${Math.round(ent.p50)}`, 0);
    mark(simResult.winningMedian, "#fbbf24", `typical winning score ${Math.round(simResult.winningMedian)}`, 16);
    // x axis labels
    ctx.fillStyle = css.getPropertyValue("--muted").trim() || "#888";
    ctx.textAlign = "left"; ctx.fillText(String(Math.round(min)), 4, H - 5);
    ctx.textAlign = "right"; ctx.fillText(String(Math.round(max)), W - 4, H - 5);
  }

  // ---------- simulation ----------
  function runSim() {
    const { rivals, errors } = parseRivals(settings.rivalsText);
    if (errors.length) console.warn("rival parse:", errors);
    $("#simStatus").textContent = "Simulating…";
    WCSim.run(snap, settings, rivals,
      (p) => { $("#simStatus").textContent = `Simulating… ${Math.round(p * 100)}%`; },
      (res) => {
        simResult = res;
        $("#simStatus").textContent = "";
        render();
        renderHistogram();
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
    $("#settingsSave").addEventListener("click", (e) => { e.preventDefault(); saveSettingsFromDlg(); });
    $("#settingsCancel").addEventListener("click", (e) => { e.preventDefault(); $("#settingsDlg").close(); });
    window.addEventListener("resize", renderHistogram);
    doRefresh(true);          // try to get fresher data than the baked snapshot
    setTimeout(autoRefreshLoop, 60e3);
  });
})();
