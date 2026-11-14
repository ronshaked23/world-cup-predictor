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
// HOME / AWAY FORM — each team's last 10 competitive home games and last 10
// away games (league + UEFA, from data.js venue10). The edge is how much
// better the team does at that venue than across all 20 games — a team that
// wins everything everywhere has no venue edge, a home fortress does.
// Shrunk with 4 phantom games so one odd result can't swing a prediction.
// Teams without venue10 fall back to this season's Champions League games.
// ---------------------------------------------------------------------------
function computeVenueForm() {
  const pts = r => 3 * r[0] + r[1];
  const cnt = r => r[0] + r[1] + r[2];
  for (const [name, t] of Object.entries(TEAMS)) {
    let rec;
    if (t.venue10) {
      rec = { home: t.venue10.home, away: t.venue10.away };
    } else {
      rec = { home: [0, 0, 0], away: [0, 0, 0] };
      playedMatches().forEach(m => {
        if (m.h !== name && m.a !== name) return;
        const home = m.h === name;
        const gf = home ? m.hs : m.as, ga = home ? m.as : m.hs;
        rec[home ? "home" : "away"][gf > ga ? 0 : gf === ga ? 1 : 2] += 1;
      });
    }
    const n = cnt(rec.home) + cnt(rec.away);
    const overall = n ? (pts(rec.home) + pts(rec.away)) / n : 1.4;
    const K = 4;
    const homePpg = (pts(rec.home) + K * overall) / (cnt(rec.home) + K);
    const awayPpg = (pts(rec.away) + K * overall) / (cnt(rec.away) + K);
    RATINGS[name].venue = {
      home: rec.home, away: rec.away, overall,
      homePpg, awayPpg,
      homeEdge: homePpg - overall, awayEdge: awayPpg - overall,
      splitKnown: !!t.venue10,
    };
  }
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

function venueMultipliers(home, away) {
  const vh = RATINGS[home].venue, va = RATINGS[away].venue;
  return {
    home: HOME_XG * clamp(1 + 0.12 * vh.homeEdge, 0.9, 1.1),
    away: AWAY_XG * clamp(1 + 0.12 * va.awayEdge, 0.9, 1.1),
  };
}

function expectedGoals(home, away, md, ignoreNews) {
  const th = TEAMS[home], ta = TEAMS[away];
  const v = venueMultipliers(home, away);
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
    reasons: reasonsFor(home, away, xgH, xgA),
  };
  predictionCache[key] = res;
  return res;
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
  const hRec = vh.home, aRec = va.away;
  out.push(`Last 10 at home, ${home}: ${hRec.join("-")} (W-D-L) · last 10 away, ${away}: ${aRec.join("-")}.`);
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

computeRatings();
