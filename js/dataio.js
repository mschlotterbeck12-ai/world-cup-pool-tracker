// Data loading: baked snapshot -> localStorage cache -> live FotMob refresh via CORS proxies.
(function () {
  const FOTMOB_URL = "https://www.fotmob.com/api/data/leagues?id=77&tab=matches";
  const PROXIES = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  const LS_KEY = "wcpool.snapshot";

  function parseScore(s) {
    const m = /^\s*(\d+)\s*-\s*(\d+)/.exec(s || "");
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [null, null];
  }

  // Same trim as scripts/make_snapshot.py, in JS, for live refreshes.
  function trimRaw(raw) {
    const matches = raw.fixtures.allMatches.map(m => {
      const st = m.status || {};
      const [h, a] = parseScore(st.scoreStr);
      return {
        id: String(m.id), round: String(m.round || ""), group: m.group || null,
        utc: st.utcTime || null,
        homeId: String(m.home.id), homeName: m.home.name,
        awayId: String(m.away.id), awayName: m.away.name,
        started: !!st.started, finished: !!st.finished, cancelled: !!st.cancelled,
        scoreH: h, scoreA: a, reason: (st.reason && st.reason.short) || null,
      };
    });
    const groups = {}, thirdTable = [];
    for (const t of raw.table[0].data.tables) {
      const rows = t.table.all.map(r => {
        const [gf, ga] = parseScore(r.scoresStr);
        return { id: String(r.id), name: r.name, played: r.played || 0, w: r.wins || 0,
          d: r.draws || 0, l: r.losses || 0, gf: gf || 0, ga: ga || 0, pts: r.pts || 0, idx: r.idx || 0 };
      });
      const gm = /^Grp\.\s*([A-L])/.exec(t.leagueName);
      if (gm) groups[gm[1]] = rows;
      else if (t.leagueName.includes("3rd")) thirdTable.push(...rows);
    }
    return { fetchedAt: new Date().toISOString(), matches, groups, thirdTable };
  }

  function newest(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a.fetchedAt || "") >= (b.fetchedAt || "") ? a : b;
  }

  function loadInitial() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* ignore */ }
    return newest(window.WC_SNAPSHOT || null, cached);
  }

  async function refresh() {
    let lastErr = null;
    for (const proxy of PROXIES) {
      try {
        const resp = await fetch(proxy(FOTMOB_URL), { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const raw = await resp.json();
        if (!raw.fixtures || !raw.fixtures.allMatches) throw new Error("unexpected payload");
        const snap = trimRaw(raw);
        try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch (e) { /* quota */ }
        return snap;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("all proxies failed");
  }

  window.WCData = { loadInitial, refresh };
})();
