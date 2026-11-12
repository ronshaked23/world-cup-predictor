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

function teamLabel(name) { return `${badge(name)}<span class="tname">${name}</span>`; }

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
  const g = gradePick(m, "pred"), gn = gradePick(m, "predNews");
  const tag = (gr, key, label) => `<span class="tag tag-${gr.cat}" title="Stored before kickoff">${label} ${m[key][0]}-${m[key][1]} · ${gr.label}</span>`;
  const note = g
    ? tag(g, "pred", "pick") + (gn ? " " + tag(gn, "predNews", "+news") : "")
    : (favP < 0.25 ? `<span class="tag tag-upset" title="Today's model gives this result ${pct(favP)}">upset · ${pct(favP)}</span>` : "");
  return `<div class="match-row">
    <span class="match-team home">${teamLabel(m.h)}</span>
    <span class="match-score">${m.hs} – ${m.as}</span>
    <span class="match-team away">${teamLabel(m.a)}</span>
    <span class="match-note">${note}</span>
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
      <div class="pred-team">${badge(m.h, "lg")}<div><div class="pt-name">${m.h}</div><div class="pt-sub">${leagueFlag(m.h)} ${rh.rating.toFixed(1)} · ${STYLES[TEAMS[m.h].style].label}</div></div></div>
      <div class="pred-score"><div class="ps-main">${p.pick.a} – ${p.pick.b}</div><div class="ps-sub">xG ${p.xgH.toFixed(2)} – ${p.xgA.toFixed(2)}</div></div>
      <div class="pred-team away"><div><div class="pt-name">${m.a}</div><div class="pt-sub">${ra.rating.toFixed(1)} · ${STYLES[TEAMS[m.a].style].label} ${leagueFlag(m.a)}</div></div>${badge(m.a, "lg")}</div>
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

function renderMatches() {
  const ms = MATCHES.filter(m => m.md === currentMd);
  const played = ms.filter(m => m.hs != null);
  const upcoming = ms.filter(m => m.hs == null);
  let summary = "";
  if (played.length) {
    const goals = played.reduce((s, m) => s + m.hs + m.as, 0);
    const homeW = played.filter(m => m.hs > m.as).length, draws = played.filter(m => m.hs === m.as).length;
    const sc = scorecard(played);
    const season = scorecard(playedMatches());
    const nc = newsComparison(played), ncSeason = newsComparison(playedMatches());
    summary = `<div class="summary-bar">Matchday ${currentMd}: <strong>${goals} goals</strong> in ${played.length} games (${(goals / played.length).toFixed(2)} per game) · home wins ${homeW}, draws ${draws}, away wins ${played.length - homeW - draws}
      ${sc ? `<div class="sc-line">${sc}${season !== sc ? ` <span class="muted">· season: ${season.replace("Picks: ", "")}</span>` : ""}</div>` : ""}
      ${nc ? `<div class="sc-line">${nc}${ncSeason !== nc ? ` <span class="muted">· season: ${ncSeason}</span>` : ""}</div>` : ""}</div>`;
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
    upcoming.map(predictionCard).join("");
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
        ${badge(name, "lg")}
        <div><div class="team-name">${name}</div><div class="team-sub">${leagueFlag(name)} ${lg.name} · league strength ${lg.coef.toFixed(2)}</div></div>
        <div class="overall"><div class="ov-n">${r.rating.toFixed(1)}</div><div class="ov-r">#${rankOf[name]}</div></div>
      </div>
      <span class="style-badge" style="background:${STYLES[t.style].color}">${STYLES[t.style].label}</span>
      ${barRow("Squad", r.squad, `Squad value ~€${t.value}m`)}
      ${barRow("Momentum", r.momentum, `2025-26: ${r.lastS.toFixed(1)} · 2024-25: ${r.prevS.toFixed(1)}`)}
      ${barRow("Form", r.form, `Domestic ${r.domRaw.toFixed(1)} · Champions League ${r.uclForm.toFixed(1)}`)}
      <div class="facts">
        <div><span>2025-26</span>${ordinal(t.last.pos)}, ${t.last.pts} pts in ${t.last.gp}${lastUcl}</div>
        <div><span>This season</span>${ordinal(d.pos)} in league · ${d.w}-${d.d}-${d.l}, ${d.gf}:${d.ga}${d.stale ? ' <span class="muted">(as of Oct 26)</span>' : ""}</div>
        <div><span>Last 10 home</span>${recordStr(v.home)} · ${v.homePpg.toFixed(2)} pts/g ${venueTag(v.homePpg)}</div>
        <div><span>Last 10 away</span>${recordStr(v.away)} · ${v.awayPpg.toFixed(2)} pts/g ${venueTag(v.awayPpg)}</div>
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
// Shrunk points-per-game at a venue, on an absolute scale.
function venueTag(ppg) {
  if (ppg >= 2.2) return `<span class="tag tag-good">strong</span>`;
  if (ppg <= 1.2) return `<span class="tag tag-bad">weak</span>`;
  return "";
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
    <p>Every league-phase game has a home team. Baseline: the home side's expected goals ×1.10, the away side's ×0.91. On top of that, each team's own record: its last 10 competitive home games and last 10 away games (league and European games; cups and friendlies are left out, since they're often against much weaker teams). The model compares each venue to the team's average across all 20, so a team that wins everywhere gets no extra boost, while a home fortress with a poor away record does. Records are shrunk with 4 average games so one odd result can't swing a prediction. The effect is capped at ±10% xG.</p>
    <h3>4. From ratings to scorelines</h3>
    <ul>
      <li>Attack × defence Poisson model: a 38-point rating gap multiplies the xG ratio by e (~2.7).</li>
      <li>Playstyle matchup (the World Cup rock-paper-scissors table), ±~10%.</li>
      <li>Game environment: teams whose games average lots of goals push the total up, and vice versa.</li>
      <li>Dixon-Coles correction for 0-0 / 1-1. The headline score is the most likely scoreline within the most likely outcome.</li>
    </ul>
    <h3>5. Team news</h3>
    <p>The day before each matchday the injury, suspension and lineup news is checked and entered as a rating shift for the affected team: roughly −1 to −2 for a key starter out, −3 to −5 for several, and up to +2 when a key player returns. A shift can hit attack and defence separately: a missing striker lowers the team's attack, a missing centre-back weakens its defence. The prediction card shows each item and what the model said without it. Both picks are stored before kickoff, so the scorecard shows whether the news check actually improves the predictions.</p>
    <h3>6. Simulation</h3>
    <p>Every remaining league-phase fixture is played ${SIMS.toLocaleString()} times by sampling a scoreline from its probability grid. Teams are then ranked with UEFA's tiebreakers (points, goal difference, goals scored, away goals, wins, away wins).</p>
    <h3>Format reminder</h3>
    <p>36 teams, 8 games each (4 home, 4 away). 1-8 go straight to the round of 16, 9-24 play two-legged play-offs in February, and 25-36 are out. The knockout bracket starts in February 2027 and will be added once the league phase ends.</p>
    <h3>Data caveats</h3>
    <p>Updated ${SNAPSHOT_DATE}. The Champions League table matches ESPN's official standings. Domestic tables, the last two seasons' final tables and every team's last-10 home/away games come from ESPN. ESPN doesn't cover the Czech, Ukrainian, Slovak and Azerbaijani leagues, so Slavia, Shakhtar, Slovan and Sabah keep their October 26 domestic numbers, and their venue form uses Champions League games only. In Belgium, Greece and Austria, points are split after the regular season, so last season's points per game there is approximate.</p>
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
