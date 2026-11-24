// ---------------------------------------------------------------------------
// Rendering / UI wiring
// ---------------------------------------------------------------------------

const SIMS = 10000;
let SIM = null;

function pct(p) {
  if (p >= 0.995) return ">99%";
  if (p > 0 && p < 0.005) return "<1%";
  return Math.round(p * 100) + "%";
}

function leagueFlag(name) {
  const lg = LEAGUES[TEAMS[name].league];
  return `<img class="flag-img" src="https://flagcdn.com/24x18/${lg.flag}.png" srcset="https://flagcdn.com/48x36/${lg.flag}.png 2x" alt="${lg.name}" title="${lg.name}">`;
}

function badge(name, size) {
  const t = TEAMS[name];
  const light = ["#ffe667", "#fde100", "#ffd100", "#ffd200", "#ffd700", "#febe10", "#6cabdd", "#5aa9e6"].includes(t.color);
  return `<span class="badge ${size || ""}" style="background:${t.color};color:${light ? "#111" : "#fff"}">${t.short}</span>`;
}

// Club crest (crests/<espn id>.png, from ESPN); if it can't load, the coloured badge takes its place.
function crest(name, size) {
  const t = TEAMS[name];
  if (!t.espn) return badge(name, size);
  return `<span class="crest-wrap ${size || ""}"><img class="crest" src="crests/${t.espn}.png" alt="" loading="lazy"
    onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'">${badge(name, size).replace('class="badge', 'class="badge fallback')}</span>`;
}

function teamLabel(name) { return `${crest(name)}<span class="tname">${name}</span>`; }

function nextMatchday() {
  const up = upcomingMatches();
  return up.length ? Math.min(...up.map(m => m.md)) : 8;
}

// ---------------------------------------------------------------------------
// LEAGUE TABLE
// ---------------------------------------------------------------------------
let tableSort = { key: "pos", dir: 1 };

function zoneClass(pos) { return pos <= 8 ? "z-top8" : pos <= 24 ? "z-po" : "z-out"; }

function renderTable() {
  const rows = currentTable().map((r, i) => ({ ...r, pos: i + 1, gd: r.gf - r.ga, sim: SIM[r.name], rating: RATINGS[r.name].rating }));
  const k = tableSort.key, dir = tableSort.dir;
  const val = r => k === "top8" || k === "playoff" || k === "out" || k === "expPts" ? r.sim[k] : r[k];
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : a.pos - b.pos) * dir);

  const col = (key, label, title) =>
    `<th data-key="${key}" class="${tableSort.key === key ? "sorted" : ""}" ${title ? `title="${title}"` : ""}>${label}${tableSort.key === key ? (dir === 1 ? " ▲" : " ▼") : ""}</th>`;

  const head = `<thead><tr>
    ${col("pos", "#")}<th class="left">Team</th>
    ${col("n", "P")}${col("w", "W")}${col("d", "D")}${col("l", "L")}${col("gd", "GD")}${col("pts", "Pts")}
    ${col("rating", "Rating", "Overall model rating")}
    ${col("expPts", "xPts", "Expected final points")}
    ${col("top8", "Top 8", "Chance of finishing 1-8")}
    ${col("playoff", "9-24", "Chance of finishing 9-24")}
    ${col("out", "Out", "Chance of finishing 25-36")}
  </tr></thead>`;

  const body = rows.map(r => {
    const s = r.sim;
    const cell = (p, cls) => `<td class="odds"><div class="odds-bar ${cls}" style="--w:${(p * 100).toFixed(1)}%"></div><span>${pct(p)}</span></td>`;
    return `<tr class="${zoneClass(r.pos)}">
      <td class="pos">${r.pos}</td>
      <td class="left team-cell">${leagueFlag(r.name)}${teamLabel(r.name)}</td>
      <td>${r.n}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
      <td>${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="pts">${r.pts}</td>
      <td>${r.rating.toFixed(1)}</td>
      <td>${s.expPts.toFixed(1)}</td>
      ${cell(s.top8, "b-top8")}${cell(s.playoff, "b-po")}${cell(s.out, "b-out")}
    </tr>`;
  }).join("");

  const el = document.getElementById("league-table");
  el.innerHTML = head + `<tbody>${body}</tbody>`;
  el.querySelectorAll("th[data-key]").forEach(th => th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (tableSort.key === key) tableSort.dir *= -1;
    else tableSort = { key, dir: key === "pos" || key === "out" || key === "l" ? 1 : -1 };
    renderTable();
  }));
}

// ---------------------------------------------------------------------------
// MATCHES & PREDICTIONS
// ---------------------------------------------------------------------------
let currentMd = null;

function renderMdPicker() {
  const next = nextMatchday();
  const el = document.getElementById("md-picker");
  el.innerHTML = Object.keys(MATCHDAY_DATES).map(md => {
    md = +md;
    const played = MATCHES.filter(m => m.md === md).every(m => m.hs != null);
    return `<button class="md-btn ${md === currentMd ? "active" : ""} ${played ? "played" : ""}" data-md="${md}">
      <span class="md-n">MD${md}</span><span class="md-d">${MATCHDAY_DATES[md]}</span>${md === next ? '<span class="md-next">next</span>' : ""}
    </button>`;
  }).join("");
  el.querySelectorAll(".md-btn").forEach(b => b.addEventListener("click", () => {
    currentMd = +b.dataset.md; renderMdPicker(); renderMatches();
  }));
}

function probBar(p) {
  return `<div class="prob-bar">
    <div class="pb-h" style="width:${p.pH * 100}%">${p.pH >= 0.12 ? pct(p.pH) : ""}</div>
    <div class="pb-d" style="width:${p.pD * 100}%">${p.pD >= 0.12 ? pct(p.pD) : ""}</div>
    <div class="pb-a" style="width:${p.pA * 100}%">${p.pA >= 0.12 ? pct(p.pA) : ""}</div>
  </div>`;
}

function resultRow(m) {
  const p = predictMatch(m.h, m.a, m.md);
  const outc = (a, b) => a > b ? "H" : a < b ? "A" : "D";
  const actual = outc(m.hs, m.as);
  const favP = { H: p.pH, D: p.pD, A: p.pA }[actual];
  const g = gradePick(m, "pred"), gn = gradePick(m, "predNews"), b = gradeBet(m);
  const tag = (gr, key, label) => `<span class="tag tag-${gr.cat}" title="Stored before kickoff">${label} ${m[key][0]}-${m[key][1]} · ${gr.label}</span>`;
  const note = g
    ? tag(g, "pred", "pick") + (gn ? " " + tag(gn, "predNews", "+news") : "")
    : (favP < 0.25 ? `<span class="tag tag-upset" title="Today's model gives this result ${pct(favP)}">upset · ${pct(favP)}</span>` : "");
  const betTag = b
    ? `<span class="tag ${b.won ? "tag-good" : "tag-bad"}" title="Winner pick saved before kickoff">${m.bet[2] === "value" ? "★" : "◆"} ${outcomeName(m, m.bet[0])} @ ${m.bet[1].toFixed(2)} · ${b.won ? "won " + signed(b.profit, 2) : "lost −1"}</span> `
    : "";
  return `<div class="match-row">
    <span class="match-team home">${teamLabel(m.h)}</span>
    <span class="match-score">${m.hs} – ${m.as}</span>
    <span class="match-team away">${teamLabel(m.a)}</span>
    <span class="match-note">${betTag}${note}</span>
  </div>`;
}

// Grade a pick stored before kickoff. key "pred" = the pure model's pick,
// "predNews" = the pick after the pre-match injury/news check. Points like a
// prediction league: 3 for the exact score, 1 for the right outcome.
function gradePick(m, key = "pred") {
  const pk = m[key];
  if (!Array.isArray(pk) || m.hs == null) return null;
  const outc = (a, b) => a > b ? "H" : a < b ? "A" : "D";
  if (pk[0] === m.hs && pk[1] === m.as) return { cat: "exact", label: "exact ✓", pts: 3 };
  if (outc(pk[0], pk[1]) === outc(m.hs, m.as)) return { cat: "good", label: "result ✓", pts: 1 };
  return { cat: "bad", label: "miss", pts: 0 };
}

// A saved Winner pick (m.bet) on a finished game: 1 unit staked.
function gradeBet(m) {
  if (!Array.isArray(m.bet) || m.hs == null) return null;
  const outcome = m.hs > m.as ? 0 : m.hs === m.as ? 1 : 2;
  const won = outcome === m.bet[0];
  return { won, profit: won ? m.bet[1] - 1 : -1 };
}

function betScorecard(ms) {
  const graded = ms.map(gradeBet).filter(Boolean);
  if (!graded.length) return "";
  const won = graded.filter(g => g.won).length;
  const units = graded.reduce((s, g) => s + g.profit, 0);
  return `Winner picks: <strong>${won}/${graded.length}</strong> won · <strong class="${units >= 0 ? "pos" : "neg"}">${signed(units, 2)} units</strong> (1 unit per pick)`;
}

function scorecard(ms, key = "pred", label = "Picks") {
  const graded = ms.map(m => gradePick(m, key)).filter(Boolean);
  if (!graded.length) return "";
  const res = graded.filter(g => g.pts > 0).length, exact = graded.filter(g => g.pts === 3).length;
  const pts = graded.reduce((s, g) => s + g.pts, 0);
  return `${label}: <strong>${res}/${graded.length}</strong> results right, <strong>${exact}</strong> exact scores · ${pts} pts (3 exact / 1 result)`;
}

// Same games, both pick sets — the only fair test of whether the pre-match
// news check helps: compare on the games where both picks were stored.
function newsComparison(ms) {
  const both = ms.filter(m => Array.isArray(m.pred) && Array.isArray(m.predNews) && m.hs != null);
  if (!both.length) return "";
  const pts = key => both.reduce((s, m) => s + gradePick(m, key).pts, 0);
  return `News check on ${both.length} games: model alone <strong>${pts("pred")}</strong> pts → with news <strong>${pts("predNews")}</strong> pts`;
}

function newsBlock(p, m) {
  if (!p.news.length) return "";
  const base = predictMatch(m.h, m.a, m.md, true);
  const shift = n => {
    const a = n.atk != null ? n.atk : (n.adj || 0), d = n.def != null ? n.def : (n.adj || 0);
    if (a === d) return signed(a);
    return [a ? `atk ${signed(a)}` : "", d ? `def ${signed(d)}` : ""].filter(Boolean).join(" / ");
  };
  const items = p.news.map(n => `<li><strong>${n.team}</strong> <span class="news-adj">${shift(n)}</span> — ${n.note}${n.date ? ` <span class="muted">(${n.date})</span>` : ""}</li>`).join("");
  return `<div class="news-box">
    <div class="news-head">Team news <span class="muted">· model alone: ${pct(base.pH)} / ${pct(base.pD)} / ${pct(base.pA)}, pick ${base.pick.a}-${base.pick.b}</span></div>
    <ul>${items}</ul>
  </div>`;
}

function predictionCard(m) {
  const p = predictMatch(m.h, m.a, m.md);
  const top = p.dist.top.map(c => `<span class="sc">${c.a}-${c.b} <em>${pct(c.prob)}</em></span>`).join("");
  const rh = RATINGS[m.h], ra = RATINGS[m.a];
  const sh = SIM[m.h], sa = SIM[m.a];
  return `<div class="pred-card">
    <div class="pred-head">
      <div class="pred-team">${crest(m.h, "lg")}<div><div class="pt-name">${m.h}</div><div class="pt-sub">${leagueFlag(m.h)} ${rh.rating.toFixed(1)} · ${STYLES[TEAMS[m.h].style].label}</div></div></div>
      <div class="pred-score"><div class="ps-main">${p.pick.a} – ${p.pick.b}</div><div class="ps-sub">xG ${p.xgH.toFixed(2)} – ${p.xgA.toFixed(2)}</div></div>
      <div class="pred-team away"><div><div class="pt-name">${m.a}</div><div class="pt-sub">${ra.rating.toFixed(1)} · ${STYLES[TEAMS[m.a].style].label} ${leagueFlag(m.a)}</div></div>${crest(m.a, "lg")}</div>
    </div>
    ${probBar(p)}
    <div class="pred-legend"><span>${m.h} win</span><span>Draw</span><span>${m.a} win</span></div>
    <div class="pred-meta">
      <span>Top scorelines: ${top}</span>
      <span>Over 2.5: <strong>${pct(p.over25)}</strong></span>
      <span>Both score: <strong>${pct(p.btts)}</strong></span>
    </div>
    ${newsBlock(p, m)}
    <ul class="reasons">${p.reasons.map(r => `<li>${r}</li>`).join("")}</ul>
    <div class="pred-stakes">Top-8 odds now: ${m.h} <strong>${pct(sh.top8)}</strong> · ${m.a} <strong>${pct(sa.top8)}</strong>${m.day ? ` · <span class="muted">${m.day}</span>` : ""}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// WINNER ODDS + RECOMMENDATIONS — the pick logic lives in predict.js (so
// tools/store_picks.js can run it too); this part is the browser side: odds a
// viewer types into a card (kept in this browser only) and the filter state.
// ---------------------------------------------------------------------------
let recoOnly = false;

function localOdds(m) {
  try { const v = JSON.parse(localStorage.getItem(oddsKey(m))); return Array.isArray(v) && v.length === 3 ? v : null; }
  catch (e) { return null; }
}

let PICKS = new Map();

function outcomeName(m, i) { return i === 0 ? m.h : i === 2 ? m.a : "Draw"; }

function fixtureRow(m) {
  const p = predictMatch(m.h, m.a, m.md);
  const o = oddsFor(m), rec = recommendation(m), pick = PICKS.get(oddsKey(m));
  const probs = [p.pH, p.pD, p.pA];
  const cells = OUTCOMES.map((lab, i) => {
    const hot = pick && pick.i === i ? (pick.tier === "value" ? "odd-reco" : "odd-lean") : "";
    return `<span class="odd ${hot}"><span class="odd-lab">${lab}</span><span class="odd-val">${o ? o[i].toFixed(2) : "–"}</span><span class="odd-p">${pct(probs[i])}</span></span>`;
  }).join("");
  const recoTag = pick
    ? `<span class="tag ${pick.tier === "value" ? "tag-exact" : "tag-lean"}">${pick.tier === "value" ? "★" : "◆"} ${outcomeName(m, pick.i)} @ ${pick.odds.toFixed(2)} · ${signed(pick.ev * 100)}%</span>`
    : (o ? "" : `<span class="tag tag-muted">no odds</span>`);
  return `<details class="fx-item" data-id="${oddsKey(m)}">
    <summary class="fx-sum">
      <span class="fx-when">${(m.day || "").replace(/^\w+ /, "")}</span>
      <span class="fx-side fx-home"><span class="fx-name">${m.h}</span>${crest(m.h, "md")}</span>
      <span class="fx-odds">${cells}</span>
      <span class="fx-side fx-away">${crest(m.a, "md")}<span class="fx-name">${m.a}</span></span>
      <span class="fx-reco">${recoTag}</span>
    </summary>
    ${oddsPanel(m, rec)}
    ${predictionCard(m)}
  </details>`;
}

function oddsPanel(m, rec) {
  const o = oddsFor(m) || ["", "", ""];
  const src = localOdds(m) ? "your entry (this browser)" : m.odds ? `Winner${m.oddsDate ? ", " + m.oddsDate : ""}` : "not entered yet";
  const inputs = OUTCOMES.map((lab, i) =>
    `<label class="odd-in">${lab}<input id="${("odds" + m.md + m.h + m.a + i).replace(/\W/g, "")}" type="number" step="0.01" min="1.01" inputmode="decimal" value="${o[i] === "" ? "" : Number(o[i]).toFixed(2)}" data-i="${i}"></label>`).join("");
  const pick = PICKS.get(oddsKey(m));
  const about = r => `${outcomeName(m, r.i)} at ${r.odds.toFixed(2)}. We give it ${pct(r.prob)} (fair odds ${r.fair.toFixed(2)}), so the expected return is ${signed(r.ev * 100)}%`;
  const verdict = !rec ? "Enter Winner's 1 / X / 2 odds to see whether this match is worth a bet."
    : pick && pick.tier === "value" ? `<strong>★ Value pick:</strong> ${about(pick)}.`
    : pick ? `<strong>◆ Lean</strong> (one of the day's best ${PER_DAY}, but no clear value): ${about(pick)}.`
    : rec.eligible ? `Not picked: best option is ${about(rec)} — other games that day are better.`
    : `Not picked: ${rec.why}.`;
  return `<div class="odds-panel" data-key="${oddsKey(m)}">
    <div class="op-row"><span class="op-title">Winner odds</span><span class="muted small">source: ${src}</span></div>
    <div class="op-row op-inputs">${inputs}${localOdds(m) ? `<button type="button" class="op-reset">Reset</button>` : ""}</div>
    <p class="op-verdict">${verdict}</p>
  </div>`;
}

function renderMatchFilters(upcoming) {
  const el = document.getElementById("match-filters");
  if (!upcoming.length) { el.innerHTML = ""; return; }
  const picks = [...PICKS.values()];
  const nValue = picks.filter(x => x.tier === "value").length;
  const withOdds = upcoming.filter(m => oddsFor(m)).length;
  el.innerHTML = `<button type="button" class="filter-btn ${recoOnly ? "active" : ""}" id="reco-toggle">★ Winner recommendations <strong>${picks.length}</strong></button>
    <span class="muted small">${nValue} value · ${picks.length - nValue} lean · ${withOdds}/${upcoming.length} games have odds · at least ${PER_DAY} per day</span>`;
  document.getElementById("reco-toggle").addEventListener("click", () => { recoOnly = !recoOnly; renderMatches(); });
}

function wireOddsInputs() {
  document.querySelectorAll(".odds-panel").forEach(panel => {
    const key = panel.dataset.key;
    panel.querySelectorAll("input").forEach(inp => inp.addEventListener("change", () => {
      const vals = [...panel.querySelectorAll("input")].map(x => parseFloat(x.value));
      if (vals.every(v => v > 1)) {
        try { localStorage.setItem(key, JSON.stringify(vals)); } catch (e) { /* storage blocked: keep page usable */ }
        renderMatches(key);
      }
    }));
    const reset = panel.querySelector(".op-reset");
    if (reset) reset.addEventListener("click", () => {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
      renderMatches(key);
    });
  });
}

function renderMatches(keepOpen) {
  const ms = MATCHES.filter(m => m.md === currentMd);
  const played = ms.filter(m => m.hs != null);
  const upcoming = ms.filter(m => m.hs == null);
  PICKS = dayPicks(upcoming);
  renderMatchFilters(upcoming);
  let summary = "";
  if (played.length) {
    const goals = played.reduce((s, m) => s + m.hs + m.as, 0);
    const homeW = played.filter(m => m.hs > m.as).length, draws = played.filter(m => m.hs === m.as).length;
    const sc = scorecard(played);
    const season = scorecard(playedMatches());
    const nc = newsComparison(played), ncSeason = newsComparison(playedMatches());
    const bc = betScorecard(played), bcSeason = betScorecard(playedMatches());
    summary = `<div class="summary-bar">Matchday ${currentMd}: <strong>${goals} goals</strong> in ${played.length} games (${(goals / played.length).toFixed(2)} per game) · home wins ${homeW}, draws ${draws}, away wins ${played.length - homeW - draws}
      ${sc ? `<div class="sc-line">${sc}${season !== sc ? ` <span class="muted">· season: ${season.replace("Picks: ", "")}</span>` : ""}</div>` : ""}
      ${nc ? `<div class="sc-line">${nc}${ncSeason !== nc ? ` <span class="muted">· season: ${ncSeason}</span>` : ""}</div>` : ""}
      ${bc ? `<div class="sc-line">${bc}${bcSeason !== bc ? ` <span class="muted">· season: ${bcSeason.replace("Winner picks: ", "")}</span>` : ""}</div>` : ""}</div>`;
  } else {
    const fav = upcoming.map(m => predictMatch(m.h, m.a, m.md)).map(p => ({ p, best: Math.max(p.pH, p.pA) })).sort((a, b) => b.best - a.best)[0];
    const close = upcoming.map(m => predictMatch(m.h, m.a, m.md)).sort((a, b) => Math.abs(a.pH - a.pA) - Math.abs(b.pH - b.pA))[0];
    if (fav && close) {
      const favName = fav.p.pH > fav.p.pA ? fav.p.home : fav.p.away;
      summary = `<div class="summary-bar">Banker: <strong>${favName}</strong> (${pct(fav.best)}) · Tightest game: <strong>${close.home} – ${close.away}</strong></div>`;
    }
  }
  document.getElementById("md-summary").innerHTML = summary;
  document.getElementById("matches-list").innerHTML =
    (played.length ? `<div class="results-list">${played.map(resultRow).join("")}</div>
      <p class="disclaimer small">${played.some(m => m.pred) ? "Picks were stored before kickoff, so this is a real scorecard." : "No picks were stored for this matchday (the model didn't exist yet). \"Upset\" = a result today's model gives under 25% — a hindsight view, since today's ratings include these games."}</p>` : "") +
    upcomingList(upcoming);
  if (keepOpen) {
    document.querySelectorAll("#matches-list details").forEach(d => {
      if (d.dataset.id === keepOpen) d.open = true;
    });
  }
  wireOddsInputs();
}

const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
function dayLabel(day) {
  const [d, ...rest] = day.split(" ");
  return DAY_NAMES[d] ? `${DAY_NAMES[d]} · ${rest.join(" ")}` : day;
}

function upcomingList(upcoming) {
  if (!upcoming.length) return "";
  let list = upcoming;
  if (recoOnly) {
    list = upcoming.filter(m => PICKS.has(oddsKey(m)))
      .sort((a, b) => PICKS.get(oddsKey(b)).ev - PICKS.get(oddsKey(a)).ev);
    if (!list.length) {
      return `<p class="empty-note">No recommended games yet. ${upcoming.some(m => oddsFor(m)) ? "None of the games with odds have an outcome we rate " + Math.round(MIN_PROB * 100) + "%+ priced at " + MIN_ODDS + "+." : "Winner's odds aren't in yet — they're added on Sunday night before each matchday."}</p>`;
    }
  }
  const days = [...new Set(upcoming.map(dayOf))].filter(day => list.some(m => dayOf(m) === day)); // calendar order
  const groups = days.map(day => {
    const ms = list.filter(m => dayOf(m) === day);
    const n = ms.filter(m => PICKS.has(oddsKey(m))).length;
    return `<div class="fx-day">${day ? dayLabel(day) : "Date to be confirmed"}<span class="fx-day-n">${ms.length} games${n ? ` · ${n} picks` : ""}</span></div>${ms.map(fixtureRow).join("")}`;
  }).join("");
  return `<div class="fx-head"><span></span><span class="fx-home">Home</span><span class="fx-odds-head"><span>1</span><span>X</span><span>2</span></span><span class="fx-away">Away</span><span></span></div>
    <div class="fx-list">${groups}</div>
    <p class="disclaimer small">Tap a game to open the full prediction. Under each price: our model's probability. ★ value pick = expected return of at least +${Math.round(MIN_EDGE * 100)}% at Winner's price. ◆ lean = among the day's best ${PER_DAY} but without clear value. Only outcomes we rate ${Math.round(MIN_PROB * 100)}%+ and priced ${MIN_ODDS}+ are considered. Not betting advice.</p>`;
}

// ---------------------------------------------------------------------------
// TEAM RATINGS
// ---------------------------------------------------------------------------
let leagueFilter = "ALL";

function renderLeagueFilters() {
  const used = [...new Set(Object.values(TEAMS).map(t => t.league))];
  const el = document.getElementById("league-filters");
  el.innerHTML = `<button class="filter-btn ${leagueFilter === "ALL" ? "active" : ""}" data-l="ALL">All</button>` +
    used.map(l => `<button class="filter-btn ${leagueFilter === l ? "active" : ""}" data-l="${l}"><img class="flag-img" src="https://flagcdn.com/24x18/${LEAGUES[l].flag}.png" alt=""> ${LEAGUES[l].name}</button>`).join("");
  el.querySelectorAll(".filter-btn").forEach(b => b.addEventListener("click", () => {
    leagueFilter = b.dataset.l; renderLeagueFilters(); renderTeams();
  }));
}

function barRow(label, value, tip) {
  const w = clamp((value - 45) / 55 * 100, 0, 100);
  return `<div class="rating-row" title="${tip || ""}"><span class="rl">${label}</span><div class="rbar"><div style="width:${w}%"></div></div><span class="rv">${value.toFixed(1)}</span></div>`;
}

function recordStr(r) { return `${r[0]}-${r[1]}-${r[2]}`; }

function renderTeams() {
  const entries = Object.entries(TEAMS)
    .filter(([, t]) => leagueFilter === "ALL" || t.league === leagueFilter)
    .sort((a, b) => RATINGS[b[0]].rating - RATINGS[a[0]].rating);
  const rankOf = Object.fromEntries(Object.keys(TEAMS).sort((a, b) => RATINGS[b].rating - RATINGS[a].rating).map((n, i) => [n, i + 1]));

  document.getElementById("teams-grid").innerHTML = entries.map(([name, t]) => {
    const r = RATINGS[name], v = r.venue, lg = LEAGUES[t.league], d = t.dom, s = SIM[name];
    const remaining = upcomingMatches().filter(m => m.h === name || m.a === name).map(m => {
      const home = m.h === name, opp = home ? m.a : m.h;
      const p = predictMatch(m.h, m.a, m.md);
      const win = home ? p.pH : p.pA;
      const cls = win >= 0.55 ? "easy" : win >= 0.35 ? "mid" : "hard";
      return `<span class="fx ${cls}" title="MD${m.md}: ${home ? "home" : "away"} vs ${opp} — win ${pct(win)}">${home ? "" : "@"}${TEAMS[opp].short}</span>`;
    }).join("");
    const lastUcl = t.last.ucl ? ` · CL: ${{ W: "winners", F: "finalists", SF: "semi-finals", QF: "quarter-finals" }[t.last.ucl]}` : "";
    return `<div class="team-card">
      <div class="team-card-header">
        ${crest(name, "lg")}
        <div><div class="team-name">${name}</div><div class="team-sub">${leagueFlag(name)} ${lg.name} · league strength ${lg.coef.toFixed(2)}</div></div>
        <div class="overall"><div class="ov-n">${r.rating.toFixed(1)}</div><div class="ov-r">#${rankOf[name]}</div></div>
      </div>
      <span class="style-badge" style="background:${STYLES[t.style].color}">${STYLES[t.style].label}</span>
      ${barRow("Squad", r.squad, `Squad value ~€${t.value}m`)}
      ${barRow("Momentum", r.momentum, `2025-26: ${r.lastS.toFixed(1)} · 2024-25: ${r.prevS.toFixed(1)}`)}
      ${barRow("Form", r.form, `Domestic ${r.domRaw.toFixed(1)} · Champions League ${r.uclForm.toFixed(1)}`)}
      <div class="facts">
        <div><span>2025-26</span>${ordinal(t.last.pos)}, ${t.last.pts} pts in ${t.last.gp}${lastUcl}</div>
        <div><span>This season</span>${ordinal(d.pos)} in league · ${d.w}-${d.d}-${d.l}, ${d.gf}:${d.ga}${t.checked ? ` <span class="muted">(checked ${t.checked})</span>` : ""}</div>
        <div class="vf-row"><span>Home</span><span><span class="rec">league ${recordStr(v.homeLeague)}</span> · <span class="rec">Europe ${recordStr(v.homeEurope)}</span></span>${venueEffect(v.homeEdge)}</div>
        <div class="vf-row"><span>Away</span><span><span class="rec">league ${recordStr(v.awayLeague)}</span> · <span class="rec">Europe ${recordStr(v.awayEurope)}</span></span>${venueEffect(v.awayEdge)}</div>
        ${v.splitKnown ? "" : `<div class="muted small">No match-by-match data for this league — venue form uses this season's Champions League games only.</div>`}
      </div>
      <p class="blurb">${t.blurb}</p>
      ${teamNewsList(name)}
      <div class="fixtures-strip"><span class="muted small">Remaining:</span> ${remaining}</div>
      <div class="qual-strip">Top 8 <strong>${pct(s.top8)}</strong> · 9-24 <strong>${pct(s.playoff)}</strong> · Out <strong>${pct(s.out)}</strong></div>
    </div>`;
  }).join("");
}

// Active news for a team: long-term items plus anything for an unplayed matchday.
function teamNewsList(name) {
  const next = nextMatchday();
  const items = ((typeof NEWS !== "undefined" && NEWS[name]) || []).filter(n => n.md == null || n.md >= next);
  if (!items.length) return "";
  return `<ul class="team-news">${items.map(n => `<li><span class="news-adj">${n.md ? "MD" + n.md : "ongoing"}</span> ${n.note}</li>`).join("")}</ul>`;
}

function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
// What the team's own home or away record does to its expected goals there.
function venueEffect(edge) {
  const pctv = Math.round((venueMul(edge) - 1) * 100);
  const cls = pctv >= 4 ? "tag-good" : pctv <= -4 ? "tag-bad" : "tag-muted";
  return `<span class="tag ${cls}" title="Effect on this team's expected goals at this venue">${pctv > 0 ? "+" : ""}${pctv}% xG</span>`;
}

// ---------------------------------------------------------------------------
// METHOD
// ---------------------------------------------------------------------------
function renderMethod() {
  const lgRows = Object.entries(LEAGUES).map(([, l]) => `<tr><td class="left"><img class="flag-img" src="https://flagcdn.com/24x18/${l.flag}.png" alt=""> ${l.name}</td><td>${l.coef.toFixed(2)}</td></tr>`).join("");
  document.getElementById("method-body").innerHTML = `
    <p class="disclaimer">A heuristic model built for fun and for sharpening betting instincts. It is not a professional forecasting service.</p>
    <h3>1. Rating each team (0-100)</h3>
    <ul>
      <li><strong>Squad (40%)</strong> — player level, measured by squad market value on a log scale (€25m ≈ 52, €400m ≈ 75, €1.4bn ≈ 86).</li>
      <li><strong>Momentum (30%)</strong> — only the last two seasons: 70% 2025-26, 30% 2024-25. Each season = points per game (70%) + goal difference per game (30%), <em>multiplied by league strength</em>. Bonus for last season's Champions League run (winner +6, final +5, semi +4, quarter +3).</li>
      <li><strong>Form (30%)</strong> — this season only. Domestic results since mid-August (league-discounted, and shrunk toward momentum when the sample is small) blended with this Champions League. Each European game counts 1.5× a domestic one, and it's judged against expectation: a draw away at Bayern is worth more than a home win over Sabah.</li>
    </ul>
    <h3>2. League strength</h3>
    <p>Domestic numbers are discounted by league. Bodø/Glimt's 2.4 points per game in Norway is a great season, but not the same as 2.4 in the Premier League.</p>
    <table class="mini-table"><thead><tr><th class="left">League</th><th>Strength</th></tr></thead><tbody>${lgRows}</tbody></table>
    <h3>3. Home and away</h3>
    <p>Every league-phase game has a home team. Baseline: the home side's expected goals ×1.10, the away side's ×0.91 (a fixture at a neutral venue gets neither). On top of that comes each team's own record, split by competition: its last ${VENUE.league} league games and last ${VENUE.europe} European games at home, and the same away. Cups and friendlies are left out. European games count ${VENUE.euroWeight}×, because those opponents look like a Champions League opponent. Each venue is compared with the team's average across all of those games, in points per game plus half the goal difference per game. A team that wins everywhere gets no boost, but a home fortress with a poor away record gets a real swing: up to ±${Math.round(VENUE.cap * 100)}% on its expected goals. The team cards show the split and the effect.</p>
    <p>The strength was set by a backtest on every league-phase game played so far, rebuilding each team's home/away form from the games before that matchday. With no team-specific effect the model scored 0.815 (log loss, lower is better); the old ±10% points-only version scored 0.811; this version scores 0.807. Pushing it to ±20% or ±25% made it worse (0.809, 0.813), because it starts chasing noise. To rerun it, use <code>tools/backtest_venue.js</code>.</p>
    <h3>4. From ratings to scorelines</h3>
    <ul>
      <li>Attack × defence Poisson model: a 38-point rating gap multiplies the xG ratio by e (~2.7).</li>
      <li>Playstyle matchup (the World Cup rock-paper-scissors table), ±~10%.</li>
      <li>Game environment: teams whose games average lots of goals push the total up, and vice versa.</li>
      <li>Dixon-Coles correction for 0-0 / 1-1. The headline score is the most likely scoreline within the most likely outcome.</li>
    </ul>
    <h3>5. Team news</h3>
    <p>The day before each matchday the injury, suspension and lineup news is checked and entered as a rating shift for the affected team: roughly −1 to −2 for a key starter out, −3 to −5 for several, and up to +2 when a key player returns. A shift can hit attack and defence separately: a missing striker lowers the team's attack, a missing centre-back weakens its defence. The prediction card shows each item and what the model said without it. Both picks are stored before kickoff, so the scorecard shows whether the news check actually improves the predictions.</p>
    <h3>6. Winner recommendations</h3>
    <p>Each upcoming game opens collapsed with Winner's 1 / X / 2 prices and, under each price, our model's probability, grouped by matchday. For every game we look at the outcomes we rate at least ${Math.round(MIN_PROB * 100)}% that Winner prices at ${MIN_ODDS} or more, and take the one with the best expected return (our probability × the price − 1). A game is a <strong>★ value pick</strong> when that return is +${Math.round(MIN_EDGE * 100)}% or better. Winner builds a margin into every price, so value picks are rare; to give at least ${PER_DAY} picks per day, the next-best games are added as <strong>◆ leans</strong>. They're the closest to fair odds that day, but their expected return can be slightly negative, and it's shown on each one. The filter at the top of the Matches tab shows only the picks, best first.</p>
    <h3>7. Simulation</h3>
    <p>Every remaining league-phase fixture is played ${SIMS.toLocaleString()} times by sampling a scoreline from its probability grid. Teams are then ranked with UEFA's tiebreakers (points, goal difference, goals scored, away goals, wins, away wins).</p>
    <h3>Format reminder</h3>
    <p>36 teams, 8 games each (4 home, 4 away). 1-8 go straight to the round of 16, 9-24 play two-legged play-offs in February, and 25-36 are out. The knockout bracket starts in February 2027 and will be added once the league phase ends.</p>
    <h3>Data caveats</h3>
    <p>Updated ${SNAPSHOT_DATE}. The Champions League table matches ESPN's official standings. The last two seasons' final tables come from ESPN. Every team's current domestic table and last-10 home/away games come from 365Scores, which covers all 16 leagues, and are refreshed every Sunday night along with Winner's odds. The Team Ratings tab shows when each team was last checked. In Belgium, Greece and Austria, points are split after the regular season, so last season's points per game there is approximate.</p>
    <h3>Scorecard</h3>
    <p>From Matchday 4 on, the model's headline pick is saved before kickoff, so the Matches tab shows a real scorecard: 3 points for an exact score, 1 for the right result.</p>`;
}

// ---------------------------------------------------------------------------
// TABS + INIT
// ---------------------------------------------------------------------------
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  }));
}

function init() {
  const played = Math.max(0, ...playedMatches().map(m => m.md));
  document.getElementById("subtitle").textContent = `Updated ${SNAPSHOT_DATE} · after Matchday ${played} of 8`;
  document.getElementById("sim-count").textContent = SIMS.toLocaleString();
  SIM = simulateLeague(SIMS);
  currentMd = nextMatchday();
  setupTabs();
  renderTable();
  renderMdPicker();
  renderMatches();
  renderLeagueFilters();
  renderTeams();
  renderMethod();
}

init();
