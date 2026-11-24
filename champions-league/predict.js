// ---------------------------------------------------------------------------
// Prediction engine — Champions League edition
//
// Same idea as the World Cup model, re-built for clubs:
//   rating = 40% squad quality + 30% momentum + 30% current form
//     squad    — squad market value (log-scaled), a proxy for player level
//     momentum — last two domestic seasons (70% 2025-26, 30% 2024-25),
//                discounted by league strength, plus a bonus for a deep
//                Champions League run last season
//     form     — this season only: domestic results since mid-August
//                (league-discounted) blended with this Champions League,
//                opponent- and venue-adjusted, recomputed from MATCHES
// Then an attack × defence Poisson model (with Dixon-Coles low-score fix)
// turns two ratings into a scoreline grid, adjusted for:
//   - home advantage, scaled by each team's own home/away record
//   - playstyle matchup (rock-paper-scissors table)
//   - "openness": how many goals each team's games produce
// A Monte Carlo simulation of the remaining fixtures gives qualification odds.
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Rock-paper-scissors style bonus (rating points), from the World Cup model.
const MATCHUP_TABLE = {
  COUNTER:  { POSSESSION: 3, PRESS: -3, PARK_BUS: 2, DIRECT: 0, TOTAL: -2, BALANCED: 2, COUNTER: 0 },
  PRESS:    { POSSESSION: 4, PARK_BUS: -5, DIRECT: 2, TOTAL: -2, COUNTER: 3, BALANCED: 1, PRESS: 0 },
  POSSESSION: { PRESS: -4, DIRECT: 3, PARK_BUS: -6, TOTAL: -3, COUNTER: -2, BALANCED: 1, POSSESSION: 0 },
  PARK_BUS: { POSSESSION: 6, PRESS: 5, COUNTER: -2, DIRECT: 1, TOTAL: 4, BALANCED: 2, PARK_BUS: 0 },
  DIRECT:   { POSSESSION: -3, PRESS: -2, PARK_BUS: -1, TOTAL: -1, COUNTER: 0, BALANCED: 0, DIRECT: 0 },
  TOTAL:    { POSSESSION: 3, PRESS: 2, PARK_BUS: -4, DIRECT: 1, COUNTER: 2, BALANCED: 2, TOTAL: 0 },
  BALANCED: { POSSESSION: -1, PRESS: -1, PARK_BUS: -2, DIRECT: 0, COUNTER: -2, TOTAL: -2, BALANCED: 0 },
};
function matchupBonus(atk, def) { return (MATCHUP_TABLE[atk] && MATCHUP_TABLE[atk][def]) || 0; }
function goalMatchupMul(atk, def) { return 1 + matchupBonus(atk, def) * 0.015; }

// Per-style attack / defence tendencies, normalized so the average is ~1.
const STYLE_GOALS = {
  POSSESSION: { atk: 1.06, def: 0.95 },
  PRESS:      { atk: 1.05, def: 1.03 },
  COUNTER:    { atk: 1.03, def: 0.97 },
  PARK_BUS:   { atk: 0.80, def: 0.86 },
  DIRECT:     { atk: 1.00, def: 1.08 },
  TOTAL:      { atk: 1.10, def: 1.04 },
  BALANCED:   { atk: 0.97, def: 0.94 },
};

const BASE_GOALS = 1.38;   // per team, neutral venue, two average CL sides
const RATING_SCALE = 38;   // rating gap that multiplies the xG ratio by e
const HOME_XG = 1.10;      // league-phase home side scores ~10% more...
const AWAY_XG = 0.91;      // ...and the away side ~9% less
const UCL_BONUS = { W: 6, F: 5, SF: 4, QF: 3 };

// ---------------------------------------------------------------------------
// RATINGS
// ---------------------------------------------------------------------------

// A season's quality on a 40-100 scale: points per game (70%) and goal
// difference per game (30%), then scaled by league strength — a dominant
// season in a weak league lands where a decent season in a top league does.
function seasonScore(ppg, gdpg, coef) {
  const q = 0.7 * clamp(ppg / 3, 0, 1) + 0.3 * clamp(0.5 + gdpg / 4, 0, 1);
  return 40 + 60 * coef * (0.35 + 0.65 * q);
}

// Squad value → player-quality rating. Log scale: going from €25m to €100m
// matters as much as €350m to €1.4bn.
function squadRating(value) { return clamp(50 + 8.5 * Math.log(value / 20), 45, 90); }

function playedMatches() { return MATCHES.filter(m => m.hs != null); }
function upcomingMatches() { return MATCHES.filter(m => m.hs == null); }

// Win-expectancy style expected points for a rating gap d (venue included).
function expectedPoints(d) { return 0.24 + 2.28 / (1 + Math.exp(-d / 9)); }

const RATINGS = {};

function computeRatings() {
  // Pass 1 — everything except this season's Champions League games
  for (const [name, t] of Object.entries(TEAMS)) {
    const coef = LEAGUES[t.league].coef;
    const squad = squadRating(t.value);
    const lastS = seasonScore(t.last.pts / t.last.gp, t.last.gd / t.last.gp, coef);
    const prevS = seasonScore(t.prevPpg, (t.prevPpg - 1.4) * 1.1, coef);
    const momentum = 0.7 * lastS + 0.3 * prevS + (UCL_BONUS[t.last.ucl] || 0);
    const d = t.dom;
    const domPpg = (3 * d.w + d.d) / d.gp;
    const domRaw = seasonScore(domPpg, (d.gf - d.ga) / d.gp, coef);
    const wD = d.gp / (d.gp + 6); // small samples lean on momentum
    const domForm = wD * domRaw + (1 - wD) * momentum;
    const pre = 0.4 * squad + 0.3 * momentum + 0.3 * domForm;
    RATINGS[name] = { squad, momentum, lastS, prevS, domRaw, domForm, pre, coef };
  }

  // Pass 2 — Champions League form: points and goal difference vs what the
  // pre-ratings expected, given opponent and venue.
  for (const name of Object.keys(TEAMS)) {
    const r = RATINGS[name];
    let perf = 0, n = 0;
    playedMatches().forEach(m => {
      if (m.h !== name && m.a !== name) return;
      const home = m.h === name;
      const opp = home ? m.a : m.h;
      const gf = home ? m.hs : m.as, ga = home ? m.as : m.hs;
      const dRating = r.pre - RATINGS[opp].pre + (home ? 4 : -4);
      const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
      perf += (pts - expectedPoints(dRating)) + 0.25 * ((gf - ga) - dRating / 12);
      n++;
    });
    r.uclN = n;
    r.uclPerf = n ? perf / n : 0;
    r.uclForm = clamp(r.pre + 6 * r.uclPerf, 40, 99);
    const domW = Math.min(TEAMS[name].dom.gp, 12);
    const uclW = 1.5 * n; // cross-league games tell us more per game
    r.form = (r.domForm * domW + r.uclForm * uclW) / (domW + uclW);
    r.rating = 0.4 * r.squad + 0.3 * r.momentum + 0.3 * r.form;
  }

  computeVenueForm();
  computeOpenness();
}

// ---------------------------------------------------------------------------
// HOME / AWAY FORM — from each team's recent competitive games (data.js
// venueGames: [date, home?, goals for, goals against, L(eague) / E(urope)]).
// At each venue we take the last VENUE.league league games and the last
// VENUE.europe European games; European games count VENUE.euroWeight times,
// since those opponents look like a Champions League opponent. The edge is
// how much better the team does there than across all of those games, in
// points per game plus VENUE.goalWeight × goal difference per game, shrunk
// by VENUE.shrink weighted phantom games. A home fortress with a poor away
// record gets a real swing (up to ±VENUE.cap on its expected goals); a team
// that wins everywhere gets none. Settings were picked by the backtest in
// tools/backtest_venue.js. Teams without venueGames fall back to this
// season's Champions League games.
// ---------------------------------------------------------------------------
const VENUE = { league: 10, europe: 6, euroWeight: 2, goalWeight: 0.5, shrink: 3, slope: 0.18, cap: 0.15 };

function emptyRec() { return { w: 0, d: 0, l: 0, gf: 0, ga: 0 }; }
function addGame(rec, gf, ga) {
  rec.gf += gf; rec.ga += ga;
  if (gf > ga) rec.w++; else if (gf === ga) rec.d++; else rec.l++;
}

// Venue form for one team using only games before asOf ("YYYY-MM-DD"; omit
// for all games). cfg defaults to VENUE; the backtest passes alternatives.
function venueFormFor(name, asOf, cfg = VENUE) {
  const t = TEAMS[name];
  let games = (t.venueGames || []).filter(g => !asOf || g[0] < asOf);
  if (!games.length) {  // fallback: this season's Champions League games
    games = playedMatches().filter(m => m.h === name || m.a === name).map(m => {
      const home = m.h === name;
      return ["", home ? 1 : 0, home ? m.hs : m.as, home ? m.as : m.hs, "E"];
    });
  }
  const side = home => {
    const at = games.filter(g => !!g[1] === home);  // newest first
    const lg = at.filter(g => g[4] === "L").slice(0, cfg.league);
    const eu = at.filter(g => g[4] === "E").slice(0, cfg.europe);
    const league = emptyRec(), europe = emptyRec();
    lg.forEach(g => addGame(league, g[2], g[3]));
    eu.forEach(g => addGame(europe, g[2], g[3]));
    const wt = lg.length + cfg.euroWeight * eu.length;
    const pts = r => 3 * r.w + r.d, gd = r => r.gf - r.ga;
    return {
      league, europe, wt,
      pts: pts(league) + cfg.euroWeight * pts(europe),
      gd: gd(league) + cfg.euroWeight * gd(europe),
      n: lg.length + eu.length,
    };
  };
  const h = side(true), a = side(false);
  const wt = h.wt + a.wt || 1;
  const oPpg = (h.pts + a.pts) / wt, oGd = (h.gd + a.gd) / wt;
  const edge = s => s.wt ? ((s.pts / s.wt - oPpg) + cfg.goalWeight * (s.gd / s.wt - oGd)) * s.wt / (s.wt + cfg.shrink) : 0;
  const rec = r => [r.w, r.d, r.l];
  const sum = (x, y) => [x.w + y.w, x.d + y.d, x.l + y.l];
  return {
    home: sum(h.league, h.europe), away: sum(a.league, a.europe),
    homeLeague: rec(h.league), homeEurope: rec(h.europe), awayLeague: rec(a.league), awayEurope: rec(a.europe),
    homePpg: h.wt ? h.pts / h.wt : oPpg, awayPpg: a.wt ? a.pts / a.wt : oPpg, overall: oPpg,
    homeEdge: edge(h), awayEdge: edge(a),
    splitKnown: !!(t.venueGames && t.venueGames.length),
  };
}

function computeVenueForm() {
  for (const name of Object.keys(TEAMS)) RATINGS[name].venue = venueFormFor(name);
}

function teamUclRecord(name) {
  const r = { n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, awayGf: 0, awayW: 0 };
  playedMatches().forEach(m => {
    if (m.h !== name && m.a !== name) return;
    const home = m.h === name;
    const gf = home ? m.hs : m.as, ga = home ? m.as : m.hs;
    r.n++; r.gf += gf; r.ga += ga;
    if (!home) r.awayGf += gf;
    if (gf > ga) { r.w++; r.pts += 3; if (!home) r.awayW++; }
    else if (gf === ga) { r.d++; r.pts += 1; }
    else r.l++;
  });
  return r;
}

// Goals per game across all of this season's games (domestic + Europe),
// relative to a typical 2.7. Feeds a mild "game environment" multiplier:
// Bayern/Barcelona games run hot, Roma/Sabah games run cold.
function computeOpenness() {
  for (const [name, t] of Object.entries(TEAMS)) {
    const u = teamUclRecord(name);
    const gpg = (t.dom.gf + t.dom.ga + u.gf + u.ga) / (t.dom.gp + u.n);
    RATINGS[name].goalsPerGame = gpg;
    RATINGS[name].openness = clamp(gpg / 2.7, 0.7, 1.5);
  }
}

// ---------------------------------------------------------------------------
// GOAL MODEL
// ---------------------------------------------------------------------------
// NEWS (data.js) — injuries, suspensions, rotation, from the pre-match check.
// Each item shifts a team's rating for one matchday (md) or, without md, for
// every remaining game (long-term absences). Split into attack and defence
// so a missing striker and a missing centre-back hurt different ends.
function newsFor(name, md) {
  const items = (typeof NEWS !== "undefined" && NEWS[name]) || [];
  return items.filter(n => n.md == null || n.md === md);
}
function newsShift(name, md) {
  return newsFor(name, md).reduce((s, n) => {
    const atk = n.atk != null ? n.atk : (n.adj || 0);
    const def = n.def != null ? n.def : (n.adj || 0);
    return { atk: s.atk + atk, def: s.def + def };
  }, { atk: 0, def: 0 });
}

function attackFactor(name, shift = 0) { return Math.exp((RATINGS[name].rating + shift - 75) / RATING_SCALE) * STYLE_GOALS[TEAMS[name].style].atk; }
function defenceFactor(name, shift = 0) { return Math.exp(-(RATINGS[name].rating + shift - 75) / RATING_SCALE) * STYLE_GOALS[TEAMS[name].style].def; }

function venueMul(edge, cfg = VENUE) { return clamp(1 + cfg.slope * edge, 1 - cfg.cap, 1 + cfg.cap); }

function venueMultipliers(home, away) {
  const vh = RATINGS[home].venue, va = RATINGS[away].venue;
  return { home: HOME_XG * venueMul(vh.homeEdge), away: AWAY_XG * venueMul(va.awayEdge) };
}

// A fixture can be played away from the home team's ground (m.neutral, e.g.
// Shakhtar's home games abroad): then neither side gets home advantage.
function fixtureOf(home, away, md) { return MATCHES.find(m => m.md === md && m.h === home && m.a === away); }

function expectedGoals(home, away, md, ignoreNews) {
  const th = TEAMS[home], ta = TEAMS[away];
  const fx = fixtureOf(home, away, md);
  const v = fx && fx.neutral ? { home: 1, away: 1 } : venueMultipliers(home, away);
  const env = Math.pow(RATINGS[home].openness * RATINGS[away].openness, 0.25);
  const zero = { atk: 0, def: 0 };
  const nh = ignoreNews ? zero : newsShift(home, md), na = ignoreNews ? zero : newsShift(away, md);
  const lamH = BASE_GOALS * attackFactor(home, nh.atk) * defenceFactor(away, na.def) * goalMatchupMul(th.style, ta.style) * v.home * env;
  const lamA = BASE_GOALS * attackFactor(away, na.atk) * defenceFactor(home, nh.def) * goalMatchupMul(ta.style, th.style) * v.away * env;
  return [clamp(lamH, 0.2, 4.2), clamp(lamA, 0.2, 4.2)];
}

// ---------------------------------------------------------------------------
// POISSON + DIXON-COLES
// ---------------------------------------------------------------------------
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function poissonP(k, lambda) { return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); }

const DIXON_COLES_RHO = -0.08;
function dixonColesTau(i, j, la, lb, rho) {
  if (i === 0 && j === 0) return 1 - la * lb * rho;
  if (i === 0 && j === 1) return 1 + la * rho;
  if (i === 1 && j === 0) return 1 + lb * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

function scoreDistribution(xgA, xgB, maxGoals = 8) {
  const cells = [];
  let total = 0;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = poissonP(i, xgA) * poissonP(j, xgB) * dixonColesTau(i, j, xgA, xgB, DIXON_COLES_RHO);
      cells.push({ a: i, b: j, prob: p });
      total += p;
    }
  }
  let winA = 0, draw = 0, winB = 0;
  cells.forEach(c => {
    c.prob /= total;
    if (c.a > c.b) winA += c.prob; else if (c.a === c.b) draw += c.prob; else winB += c.prob;
  });
  const sorted = cells.slice().sort((x, y) => y.prob - x.prob);
  const favOutcome = (winA >= draw && winA >= winB) ? "A" : (draw >= winB ? "D" : "B");
  return { cells, sorted, top: sorted.slice(0, 3), favOutcome, winA, draw, winB };
}

// Headline pick: most likely scoreline within the most likely outcome, with a
// small favourite boost (from the World Cup backtest — favourites convert
// superiority into more goals than a symmetric Poisson expects).
function pickHeadline(xgA, xgB, base) {
  const gap = Math.min(Math.abs(xgA - xgB), 0.9);
  let bA = xgA, bB = xgB;
  if (xgA > xgB) bA = Math.min(xgA * (1 + 0.5 * gap), 3.6);
  else if (xgB > xgA) bB = Math.min(xgB * (1 + 0.5 * gap), 3.6);
  const boosted = scoreDistribution(bA, bB);
  const outcomeOf = c => c.a > c.b ? "A" : (c.a < c.b ? "B" : "D");
  return boosted.sorted.find(c => outcomeOf(c) === base.favOutcome) || base.sorted[0];
}

// ---------------------------------------------------------------------------
// MATCH PREDICTION
// ---------------------------------------------------------------------------
// md = the matchday (selects which NEWS items apply). ignoreNews gives the
// pure-model view, used to show what the news changed.
const predictionCache = {};
function predictMatch(home, away, md, ignoreNews = false) {
  const key = [home, away, md, ignoreNews].join("|");
  if (predictionCache[key]) return predictionCache[key];
  const [xgH, xgA] = expectedGoals(home, away, md, ignoreNews);
  const dist = scoreDistribution(xgH, xgA);
  const pick = pickHeadline(xgH, xgA, dist);
  const over25 = dist.cells.reduce((s, c) => s + (c.a + c.b >= 3 ? c.prob : 0), 0);
  const btts = dist.cells.reduce((s, c) => s + (c.a > 0 && c.b > 0 ? c.prob : 0), 0);
  const news = ignoreNews ? [] : [
    ...newsFor(home, md).map(n => ({ team: home, ...n })),
    ...newsFor(away, md).map(n => ({ team: away, ...n })),
  ];
  const res = {
    home, away, md, xgH, xgA, dist, pick, over25, btts, news,
    pH: dist.winA, pD: dist.draw, pA: dist.winB,
    reasons: neutralNote(home, away, md).concat(reasonsFor(home, away, xgH, xgA)),
  };
  predictionCache[key] = res;
  return res;
}

function neutralNote(home, away, md) {
  const fx = fixtureOf(home, away, md);
  if (!fx || !fx.neutral) return [];
  return [`Neutral venue${fx.venue ? " (" + fx.venue + ")" : ""}: ${home} get no home advantage.`];
}

function signed(n, digits = 0) { const v = n.toFixed(digits); return n >= 0 ? "+" + v : v; }

function reasonsFor(home, away) {
  const rh = RATINGS[home], ra = RATINGS[away];
  const out = [];
  const gap = rh.rating - ra.rating;
  if (Math.abs(gap) >= 2) {
    const better = gap > 0 ? home : away;
    const R = RATINGS[better], O = RATINGS[gap > 0 ? away : home];
    const parts = [];
    if (R.squad - O.squad >= 3) parts.push("deeper squad");
    if (R.momentum - O.momentum >= 3) parts.push("stronger last two seasons");
    if (R.form - O.form >= 3) parts.push("better current form");
    out.push(`${better} rate ${Math.abs(gap).toFixed(1)} points higher${parts.length ? " — " + parts.join(", ") : ""}.`);
  } else {
    out.push("Near-identical overall ratings — a genuine coin-flip on quality.");
  }
  const vh = rh.venue, va = ra.venue;
  const pctMul = e => signed((venueMul(e) - 1) * 100);
  out.push(`${home} at home: league ${vh.homeLeague.join("-")}, Europe ${vh.homeEurope.join("-")} (W-D-L) → ${pctMul(vh.homeEdge)}% xG · `
    + `${away} away: league ${va.awayLeague.join("-")}, Europe ${va.awayEurope.join("-")} → ${pctMul(va.awayEdge)}% xG.`);
  const mb = matchupBonus(TEAMS[home].style, TEAMS[away].style) - matchupBonus(TEAMS[away].style, TEAMS[home].style);
  if (Math.abs(mb) >= 3) {
    const fav = mb > 0 ? home : away, other = mb > 0 ? away : home;
    out.push(`Style edge to ${fav}: ${STYLES[TEAMS[fav].style].label} tends to trouble ${STYLES[TEAMS[other].style].label}.`);
  }
  const env = Math.pow(rh.openness * ra.openness, 0.5);
  if (env >= 1.18) out.push(`Both teams' games average lots of goals (${rh.goalsPerGame.toFixed(1)} and ${ra.goalsPerGame.toFixed(1)} per game) — expect it open.`);
  else if (env <= 0.85) out.push(`Low-scoring profiles (${rh.goalsPerGame.toFixed(1)} and ${ra.goalsPerGame.toFixed(1)} goals per game) — unders territory.`);
  return out;
}

// ---------------------------------------------------------------------------
// LEAGUE TABLE
// ---------------------------------------------------------------------------
// UEFA tiebreakers (simplified): points, goal difference, goals scored, away
// goals scored, wins, away wins.
function sortTable(rows) {
  return rows.sort((x, y) =>
    y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf ||
    y.awayGf - x.awayGf || y.w - x.w || y.awayW - x.awayW || x.name.localeCompare(y.name));
}

function currentTable() {
  return sortTable(Object.keys(TEAMS).map(name => ({ name, ...teamUclRecord(name) })));
}

// ---------------------------------------------------------------------------
// MONTE CARLO — play out every remaining fixture N times by sampling a
// scoreline from each match's probability grid, then rank with the tiebreakers.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateLeague(nSims = 10000, seed = 20261026) {
  const names = Object.keys(TEAMS);
  const idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const base = names.map(n => teamUclRecord(n));
  const games = upcomingMatches().map(m => {
    const p = predictMatch(m.h, m.a, m.md);
    let acc = 0;
    const cum = p.dist.cells.map(c => { acc += c.prob; return { a: c.a, b: c.b, c: acc }; });
    return { h: idx[m.h], a: idx[m.a], cum };
  });
  const rng = mulberry32(seed);
  const N = names.length;
  const posCount = names.map(() => new Array(N).fill(0));
  const ptsSum = new Array(N).fill(0);
  const pts = new Array(N), gd = new Array(N), gf = new Array(N), agf = new Array(N), w = new Array(N), aw = new Array(N);
  const order = names.map((_, i) => i);

  for (let s = 0; s < nSims; s++) {
    for (let i = 0; i < N; i++) {
      const b = base[i];
      pts[i] = b.pts; gd[i] = b.gf - b.ga; gf[i] = b.gf; agf[i] = b.awayGf; w[i] = b.w; aw[i] = b.awayW;
    }
    for (const g of games) {
      const r = rng();
      let k = 0;
      while (k < g.cum.length - 1 && g.cum[k].c < r) k++;
      const hs = g.cum[k].a, as = g.cum[k].b;
      gf[g.h] += hs; gf[g.a] += as; agf[g.a] += as;
      gd[g.h] += hs - as; gd[g.a] += as - hs;
      if (hs > as) { pts[g.h] += 3; w[g.h]++; }
      else if (hs < as) { pts[g.a] += 3; w[g.a]++; aw[g.a]++; }
      else { pts[g.h]++; pts[g.a]++; }
    }
    order.sort((x, y) => pts[y] - pts[x] || gd[y] - gd[x] || gf[y] - gf[x] || agf[y] - agf[x] || w[y] - w[x] || aw[y] - aw[x] || (rng() - 0.5));
    order.forEach((t, pos) => { posCount[t][pos]++; ptsSum[t] += pts[t]; });
  }

  const out = {};
  names.forEach((n, i) => {
    const c = posCount[i];
    const sum = (a, b) => c.slice(a, b).reduce((x, y) => x + y, 0) / nSims;
    let modal = 0; c.forEach((v, k) => { if (v > c[modal]) modal = k; });
    out[n] = {
      first: c[0] / nSims, top8: sum(0, 8), playoff: sum(8, 24), out: sum(24, 36),
      expPts: ptsSum[i] / nSims, modalPos: modal + 1, dist: c.map(v => v / nSims),
    };
  });
  return out;
}

// ---------------------------------------------------------------------------
// WINNER ODDS + RECOMMENDATIONS
// Odds come from data.js (m.odds = [1, X, 2], Winner's decimal odds) or from
// the viewer's own entry in the expanded card, kept in this browser only.
// Each game's best bet is the outcome with the highest expected return
// (model probability × Winner's price − 1) among prices of at least MIN_ODDS
// that we rate at least MIN_PROB — shorter prices aren't worth it, longer
// shots are too swingy. Every day gets every value bet (expected return ≥
// MIN_EDGE), topped up with the next-best games so there are at least
// PER_DAY picks; those top-ups are marked "lean" and show their (possibly
// negative) expected return.
// ---------------------------------------------------------------------------
const MIN_ODDS = 1.4;
const MIN_EDGE = 0.03;
const MIN_PROB = 0.33;
const PER_DAY = 3;
const OUTCOMES = ["1", "X", "2"];

function oddsKey(m) { return `odds:${m.md}:${m.h}:${m.a}`; }
// Odds a viewer typed in (browser only, see app.js) win over data.js.
function oddsFor(m) { return (typeof localOdds === "function" && localOdds(m)) || m.odds || null; }

function recommendation(m) {
  const o = oddsFor(m);
  if (!o) return null;
  const p = predictMatch(m.h, m.a, m.md);
  const probs = [p.pH, p.pD, p.pA];
  const bet = i => ({ i, label: OUTCOMES[i], odds: o[i], prob: probs[i], ev: probs[i] * o[i] - 1, fair: 1 / probs[i] });
  const options = [0, 1, 2].filter(i => o[i] >= MIN_ODDS && probs[i] >= MIN_PROB).map(bet).sort((a, b) => b.ev - a.ev);
  if (!options.length) {
    const fav = bet(probs.indexOf(Math.max(...probs)));
    return { ...fav, eligible: false, value: false,
      why: fav.odds < MIN_ODDS ? `the likely outcome is priced ${fav.odds.toFixed(2)}, below ${MIN_ODDS}` : `nothing we rate ${Math.round(MIN_PROB * 100)}%+ is priced at ${MIN_ODDS}+` };
  }
  return { ...options[0], eligible: true, value: options[0].ev >= MIN_EDGE };
}

function dayOf(m) { return m.day || ""; }

// The picks for a list of games: per day, all value bets plus the best
// remaining games until there are PER_DAY. Map of oddsKey -> recommendation.
// A day whose picks were saved before kickoff (m.bet, by tools/store_picks.js)
// shows those saved picks, so what was recommended doesn't drift afterwards.
function savedPick(m) {
  const [i, odds, tier] = m.bet;
  const p = predictMatch(m.h, m.a, m.md);
  const prob = [p.pH, p.pD, p.pA][i];
  return { i, label: OUTCOMES[i], odds, tier, prob, ev: prob * odds - 1, fair: 1 / prob, saved: true };
}

function dayPicks(games) {
  const picks = new Map();
  [...new Set(games.map(dayOf))].forEach(day => {
    const ms = games.filter(m => dayOf(m) === day);
    if (ms.some(m => m.bet)) {
      ms.filter(m => m.bet).forEach(m => picks.set(oddsKey(m), savedPick(m)));
      return;
    }
    ms
      .map(m => ({ m, r: recommendation(m) }))
      .filter(x => x.r && x.r.eligible)
      .sort((a, b) => b.r.ev - a.r.ev)
      .forEach((x, k) => { if (x.r.value || k < PER_DAY) picks.set(oddsKey(x.m), { ...x.r, tier: x.r.value ? "value" : "lean" }); });
  });
  return picks;
}

computeRatings();
