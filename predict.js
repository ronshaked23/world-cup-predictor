// ---------------------------------------------------------------------------
// Prediction engine (v2 — goal-tuned + game-state scenarios)
//
// Scoreline model: an attack-strength × defensive-weakness Poisson model, the
// same Dixon-Coles style approach sportsbooks use for correct-score markets.
// Each team gets an attack rating and a "goals conceded" factor derived from
// its strength, tournament form, and playstyle, plus a style-vs-style modifier.
// This makes strong attacking teams project 3s against leaky defenses while two
// low blocks project 0-0/1-0 — i.e. scorelines that fit each team's identity.
//
// Game-state model: a heuristic engine (NOT a live match database) encoding
// modern-era football tendencies — how the goal rate shifts once someone leads,
// depending on both teams' playstyles. Used to answer "if X goes 1-0 up, does
// the game open up or go to sleep?"
// ---------------------------------------------------------------------------

// Rock-paper-scissors style bonus (rating points) — also feeds the goal model.
// Calibrated July 4 2026: tuned midway between our R32 backtest optimum and
// de-vigged sportsbook lines for the R16 (see calibration notes in README).
const MATCHUP_TABLE = {
  COUNTER:  { POSSESSION: 3, PRESS: -3, PARK_BUS: 2, DIRECT: 0, TOTAL: -2, BALANCED: 2, COUNTER: 0 },
  PRESS:    { POSSESSION: 4, PARK_BUS: -5, DIRECT: 2, TOTAL: -2, COUNTER: 3, BALANCED: 1, PRESS: 0 },
  POSSESSION: { PRESS: -4, DIRECT: 3, PARK_BUS: -6, TOTAL: -3, COUNTER: -2, BALANCED: 1, POSSESSION: 0 },
  PARK_BUS: { POSSESSION: 6, PRESS: 5, COUNTER: -2, DIRECT: 1, TOTAL: 4, BALANCED: 2, PARK_BUS: 0 },
  DIRECT:   { POSSESSION: -3, PRESS: -2, PARK_BUS: -1, TOTAL: -1, COUNTER: 0, BALANCED: 0, DIRECT: 0 },
  TOTAL:    { POSSESSION: 3, PRESS: 2, PARK_BUS: -4, DIRECT: 1, COUNTER: 2, BALANCED: 2, TOTAL: 0 },
  BALANCED: { POSSESSION: -1, PRESS: -1, PARK_BUS: -2, DIRECT: 0, COUNTER: -2, TOTAL: -2, BALANCED: 0 },
};

function matchupBonus(attackerStyle, opponentStyle) {
  return (MATCHUP_TABLE[attackerStyle] && MATCHUP_TABLE[attackerStyle][opponentStyle]) || 0;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------------------
// GOAL MODEL
// ---------------------------------------------------------------------------

// Per-style attack (goals created) and defence (goals conceded) tendencies.
// def < 1 means the style concedes fewer than average.
const STYLE_GOALS = {
  POSSESSION: { atk: 1.15, def: 0.85 },
  PRESS:      { atk: 1.12, def: 1.00 },
  COUNTER:    { atk: 1.12, def: 0.85 },
  PARK_BUS:   { atk: 0.72, def: 0.74 }, // softened vs QF market: 0.66 over-rewarded bus defenses, inflating draws + underdog upsets vs elite attacks
  DIRECT:     { atk: 1.08, def: 1.12 },
  TOTAL:      { atk: 1.20, def: 0.92 },
  BALANCED:   { atk: 1.00, def: 0.92 },
};

const BASE_GOALS = 1.58; // league-average expected goals per team, bumped up
const AVG_STYLE_ATK = 1.05; // tournament-average attack factor
const AVG_STYLE_DEF = 0.92; // tournament-average defence factor
const HOST_COUNTRY = { "USA": "US", "Mexico": "MX", "Canada": "CA" };

// strength = long-term talent, momentum = ~18-24mo real record under the
// current manager, form = this-tournament-only sample. Momentum is what was
// missing before: a team's actual recent era, not just a single small sample
// of tournament games, which could otherwise swamp real pedigree (see the
// Mexico/England case — 4 tournament games shouldn't outweigh a manager's
// genuine multi-year record).
// formOverride lets group-mode backtesting use ONLY the group-derived form
// (see teamFactors below) — without it, TEAMS[name].form (which reflects the
// full tournament including knockout rounds) would leak into the "honest"
// out-of-sample backtest that's supposed to be predicting those very games.
function effectiveRating(team, formOverride) {
  const momentum = team.momentum != null ? team.momentum : team.strength;
  const form = formOverride != null ? formOverride : team.form;
  return 0.40 * team.strength + 0.35 * momentum + 0.25 * form;
}
function strengthFactor(team, formOverride) { return 1 + (effectiveRating(team, formOverride) - 79) / 26; } // sharpened again vs QF market — model was underrating favourites (backtest 44→48, market gap 40→30)

// Style match-up as an xG multiplier (reuses the rating table, ~±16%).
function goalMatchupMul(atkStyle, defStyle) { return 1 + matchupBonus(atkStyle, defStyle) * 0.02; }

// PACE vs LINE HEIGHT — the orthogonal tactical axis (see TACTICAL in data.js).
// A pacy attacker (pace>5) gains xG against a high defensive line (space in
// behind) and loses a little against a deep block (nowhere to run). A slow
// attacker (pace<=5) is unaffected either way — this isn't a general quality
// bump, it's specifically the pace-in-behind dynamic. Deliberately small
// (±~10%), on the same scale as the style multiplier, so it nudges rather
// than dominates — but it's independent of strength/momentum/form, which is
// exactly what lets it break otherwise-deadlocked matchups.
function tacticalOf(name) {
  const t = (typeof TACTICAL !== "undefined" && TACTICAL[name]) || {};
  return { pace: t.pace != null ? t.pace : 5, line: t.line != null ? t.line : 5, defSpeed: t.defSpeed != null ? t.defSpeed : 5 };
}
// Pace vs line, GATED by defender recovery speed. A high line only leaks to a
// pacy attack if that attack can actually out-run the defenders covering the
// space — fast fullbacks (Nuno Mendes / Walker / Akanji) neutralize it even
// behind a high line. Against a deep block the pace is wasted regardless of
// defender speed (there's no space in behind to run into).
// NOTE: with a neutral defSpeed of 5 this reduces EXACTLY to the previous
// pace-vs-line formula, so it's backtest-neutral until real defSpeed values
// are populated — then only high-line matchups shift.
function paceLineMul(attName, defName) {
  const att = tacticalOf(attName), def = tacticalOf(defName);
  const space = (def.line - 5) / 5; // +high line (space in behind) .. -deep block
  if (space >= 0) {
    const paceSup = clamp((att.pace - def.defSpeed) / 5, 0, 1); // does the attack out-pace the D?
    return clamp(1 + 0.12 * space * paceSup, 0.9, 1.14);
  }
  const paceExcess = Math.max(0, (att.pace - 5) / 5);
  return clamp(1 + 0.12 * space * paceExcess, 0.9, 1.12); // deep block: pace wasted
}

// Human-readable summary of the pace-vs-line duel for a card. Describes each
// attacking direction that has a meaningful edge (or the interesting "fast
// fullbacks cover a high line" neutralization), so the model factor is visible.
function paceMatchupNote(nameA, nameB) {
  const tA = tacticalOf(nameA), tB = tacticalOf(nameB);
  const describe = (attName, att, defName, def) => {
    const mul = paceLineMul(attName, defName);
    const pct = Math.round((mul - 1) * 100);
    if (mul >= 1.02) return `${attName}'s pace (${att.pace}) runs in behind ${defName}'s high line (+${pct}% xG)`;
    if (mul <= 0.98) {
      return def.line <= 4
        ? `${attName}'s pace is smothered by ${defName}'s deep block (${pct}%)`
        : `${defName} blunts ${attName}'s pace (${pct}%)`;
    }
    // Near-neutral but interesting: a high line that SHOULD leak, held together
    // by recovery pace (the Nuno-Mendes / Akanji effect).
    if (def.line >= 6.5 && att.pace >= 7)
      return `${defName}'s recovery pace (${def.defSpeed}) covers the space behind its high line, neutralizing ${attName}`;
    return null;
  };
  const notes = [describe(nameA, tA, nameB, tB), describe(nameB, tB, nameA, tA)].filter(Boolean);
  return {
    aMul: paceLineMul(nameA, nameB),
    bMul: paceLineMul(nameB, nameA),
    note: notes.length ? notes.join(" · ") : "Neither attack gets clean space in behind — pace is a non-factor here.",
  };
}

// ---------------------------------------------------------------------------
// CREATIVITY — top-3 playmakers, weighted, then adjusted for how much the
// specific opponent's defensive approach lets them operate (the "Olise
// effect": aggressive/physical marking shuts creative players down, a low
// block or a team that doesn't press hard hands them time and space).
// ---------------------------------------------------------------------------
function teamCreativity(name) {
  const p = PLAYMAKERS[name];
  if (!p || p.length === 0) return null;
  const w = [0.45, 0.3, 0.25];
  let sum = 0, wsum = 0;
  p.forEach((pl, i) => { const ww = w[i] || 0.2; sum += pl.creativity * ww; wsum += ww; });
  return sum / wsum;
}

// xG multiplier for the ATTACKING team, given the opponent's defensive style.
// Centered on a 7.5-rated trio (roughly a middling top/32 attacking unit) so
// an elite (9+) creative core against a press/direct side that fouls its way
// out of trouble comes back close to neutral, while that same core against a
// bus or a possession side that doesn't press hard gets a real bump.
function creativityXgMul(name, opponentStyle) {
  const c = teamCreativity(name);
  if (c == null) return 1;
  const supp = CREATIVITY_SUPPRESSION[opponentStyle] != null ? CREATIVITY_SUPPRESSION[opponentStyle] : 1;
  const raw = (c - 7.5) * 0.05 * supp; // real range across this cup's playmaker pool: ~0.97-1.10
  return clamp(1 + raw, 0.85, 1.2);
}

// ---------------------------------------------------------------------------
// TOURNAMENT MODEL — computed from this World Cup's actual games.
//   form:    schedule-adjusted group-stage performance (points earned vs
//            points expected given the group opponents' ratings)
//   atk/def: empirical goals scored/conceded per game, opponent-adjusted and
//            shrunk toward the style prior (small samples stay humble)
//   dr:      draw rate — teams that keep finishing level are flagged as
//            draw-prone (pens don't matter in the prediction game, but a
//            120' draw is a scoreline nobody else dares to pick)
// Two variants: grp (group games only — used for honest out-of-sample
// backtesting on the R32) and full (group + R32 — used for live predictions).
// ---------------------------------------------------------------------------
const TOURN = {};

function oppStrength(o) { return typeof o === "number" ? o : (TEAMS[o] ? TEAMS[o].strength : 70); }
function sfFromStrength(S) { return 1 + (S - 79) / 32; }

// All of a team's completed knockout games so far (Round of 32, Round of 16,
// QF, ... — as many as have been played). Accumulates across the whole
// tournament, not just the most recent round, so this keeps working as the
// daily-update skill appends new rounds to RESULTS.
function knockoutGamesFor(name) {
  return RESULTS.filter(r => r.scoreA !== null && (r.a === name || r.b === name));
}

function computeTournamentModel() {
  for (const name of Object.keys(TEAMS)) {
    const g = GROUP_STAGE[name];
    if (!g) { TOURN[name] = null; continue; }

    // Schedule-adjusted GROUP form: points earned vs points expected given
    // pre-tournament strength of the three group opponents.
    let expPts = 0;
    g.opps.forEach(o => {
      const d = TEAMS[name].strength - oppStrength(o);
      const w = 1 / (1 + Math.pow(10, -d / 22));
      expPts += 3 * w * 0.76 + 0.24; // 24% baseline draw share
    });
    const groupPts = g.w * 3 + g.d;
    const groupForm = clamp(TEAMS[name].strength + 14 * (groupPts - expPts) / 3, 62, 97);

    // Opponent-adjusted goal factors — group games are always the base
    const sumInvSF = g.opps.reduce((s, o) => s + 1 / sfFromStrength(oppStrength(o)), 0);
    const sumSF    = g.opps.reduce((s, o) => s + sfFromStrength(oppStrength(o)), 0);
    const grp = {
      n: 3,
      atkObs: clamp(g.gf / (BASE_GOALS * AVG_STYLE_DEF * sumInvSF), 0.55, 1.85),
      defObs: clamp(g.ga / (BASE_GOALS * AVG_STYLE_ATK * sumSF), 0.5, 1.85),
      dr: g.d / 3,
      form: Math.round(groupForm), // GROUP-ONLY — this is what mode:"group" backtesting reads
    };

    // Fold in EVERY completed knockout game (R32, R16, QF, SF, F — however
    // many have been played), not just the first one.
    let gf = g.gf, ga = g.ga, games = 3, draws = g.d;
    let expGF = BASE_GOALS * AVG_STYLE_DEF * sumInvSF;
    let expGA = BASE_GOALS * AVG_STYLE_ATK * sumSF;
    let formScore = groupForm;
    knockoutGamesFor(name).forEach(r => {
      const mine = r.a === name;
      const oppName = mine ? r.b : r.a;
      const myScore = mine ? r.scoreA : r.scoreB;
      const oppScore = mine ? r.scoreB : r.scoreA;

      gf += myScore; ga += oppScore;
      expGF += BASE_GOALS * AVG_STYLE_DEF / sfFromStrength(oppStrength(oppName));
      expGA += BASE_GOALS * AVG_STYLE_ATK * sfFromStrength(oppStrength(oppName));
      games += 1;
      if (myScore === oppScore) draws += 1; // 120' draw = draw signal, pens irrelevant

      // Knockout over/under-performance also nudges form: an unexpected win
      // (or scare) is more informative per-game than group form alone.
      const d = TEAMS[name].strength - oppStrength(oppName);
      const expWin = 1 / (1 + Math.pow(10, -d / 22));
      const actual = myScore > oppScore ? 1 : (myScore === oppScore ? 0.5 : 0);
      formScore += 5 * (actual - expWin);
    });

    const fullForm = clamp(formScore, 62, 97);
    const full = {
      n: games,
      atkObs: clamp(gf / expGF, 0.55, 1.85),
      defObs: clamp(ga / expGA, 0.5, 1.85),
      dr: draws / games,
      form: Math.round(fullForm), // group + all knockout rounds so far — what live predictions read
    };

    TEAMS[name].form = Math.round(fullForm); // UI display always shows the live (full) form
    TOURN[name] = { grp, full };
  }
}

// Blend observed factors with the style/strength prior: weight n/(n+9), so
// small samples stay humble. Uses the MODE-APPROPRIATE form (group-only for
// backtesting, full for live) so backtests never peek at the games they're
// meant to be predicting.
function teamFactors(name, team, mode) {
  const t = TOURN[name];
  const formForMode = t ? (mode === "group" ? t.grp.form : t.full.form) : undefined;
  const priorAtk = STYLE_GOALS[team.style].atk * strengthFactor(team, formForMode);
  const priorDef = STYLE_GOALS[team.style].def / strengthFactor(team, formForMode);
  if (!t) return { atk: priorAtk, def: priorDef, dr: 0.24 };
  const m = mode === "group" ? t.grp : t.full;
  const w = m.n / (m.n + 9); // k=9: 4 tournament games alone can no longer swamp long-term pedigree
  return {
    atk: w * (m.atkObs * AVG_STYLE_ATK) + (1 - w) * priorAtk,
    def: w * (m.defObs * AVG_STYLE_DEF) + (1 - w) * priorDef,
    dr: m.dr,
  };
}

// opts: { mode: "full"|"group", venueCountry: "US"|"MX"|"CA"|undefined }
function expectedGoals(nameA, nameB, opts = {}) {
  const teamA = TEAMS[nameA], teamB = TEAMS[nameB];
  const mode = opts.mode || "full";
  const fA = teamFactors(nameA, teamA, mode);
  const fB = teamFactors(nameB, teamB, mode);

  let lamA = BASE_GOALS * fA.atk * fB.def * goalMatchupMul(teamA.style, teamB.style) * creativityXgMul(nameA, teamB.style) * paceLineMul(nameA, nameB);
  let lamB = BASE_GOALS * fB.atk * fA.def * goalMatchupMul(teamB.style, teamA.style) * creativityXgMul(nameB, teamA.style) * paceLineMul(nameB, nameA);

  // Draw propensity: teams that keep finishing level (excess over the 24%
  // baseline) drag the game toward fewer, more even goals.
  const dprop = clamp((fA.dr + fB.dr) / 2 - 0.24, 0, 0.5);
  lamA *= 1 - 0.35 * dprop;
  lamB *= 1 - 0.35 * dprop;
  const mean = (lamA + lamB) / 2;
  lamA = mean + (lamA - mean) * (1 - 0.5 * dprop);
  lamB = mean + (lamB - mean) * (1 - 0.5 * dprop);

  // Host-nation home advantage (hosts are 3/3 in knockouts so far)
  if (opts.venueCountry) {
    if (HOST_COUNTRY[nameA] === opts.venueCountry) { lamA *= 1.12; lamB *= 0.95; }
    if (HOST_COUNTRY[nameB] === opts.venueCountry) { lamB *= 1.12; lamA *= 0.95; }
  }

  return [clamp(lamA, 0.25, 3.8), clamp(lamB, 0.25, 3.8)];
}

// ---------------------------------------------------------------------------
// POISSON
// ---------------------------------------------------------------------------

function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
function poissonP(k, lambda) { return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); }

// Dixon-Coles low-score correction: an independent Poisson systematically
// underestimates 0-0 and 1-1 (and overestimates 1-0/0-1) because real
// football's low-scoring outcomes are correlated — cagey games stay cagey at
// both ends. Negative rho shifts mass back onto the draws. Value chosen by
// sweeping against our R32 backtest + de-vigged market lines (fixed our
// persistent ~5-point draw-probability shortfall vs the books at no cost).
const DIXON_COLES_RHO = -0.08; // reduced from -0.15: the old value over-added draws in lopsided QF matchups (market draw ~24% vs our 31%)

function dixonColesTau(i, j, la, lb, rho) {
  if (i === 0 && j === 0) return 1 - la * lb * rho;
  if (i === 0 && j === 1) return 1 + la * rho;
  if (i === 1 && j === 0) return 1 + lb * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// Full score matrix → most-likely scorelines + win/draw/loss probabilities.
function scoreDistribution(xgA, xgB, maxGoals = 7) {
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
    c.prob /= total; // renormalize after the tau reweighting
    if (c.a > c.b) winA += c.prob; else if (c.a === c.b) draw += c.prob; else winB += c.prob;
  });
  cells.sort((x, y) => y.prob - x.prob);

  // Headline scoreline: the most likely score CONDITIONAL on the most likely
  // outcome (W/D/L). Using the raw argmax cell over-predicts draws, because in
  // an even game the modal single scoreline is a draw even when "a win" is the
  // more probable result overall. Conditioning fixes that draw bias.
  const favOutcome = (winA >= draw && winA >= winB) ? "A" : (draw >= winB ? "D" : "B");
  const outcomeOf = (c) => c.a > c.b ? "A" : (c.a < c.b ? "B" : "D");
  const pick = cells.find(c => outcomeOf(c) === favOutcome) || cells[0];

  return { top: cells.slice(0, 3), cells, pick, favOutcome, winA, draw, winB };
}

// Headline-scoreline pick with a "favourite goal boost": in this tournament's
// knockouts, favourites converted their superiority into MORE goals than a
// symmetric Poisson expects (R32 backtest: boosting the favourite's xG for the
// point-estimate only lifted the score from 33/70 to 42/70). Probabilities
// (win/draw/win, correct-score odds) stay unboosted and market-calibrated —
// this only affects which single scoreline we put our name on.
function pickHeadline(xgA, xgB, baseDist) {
  const gap = Math.min(Math.abs(xgA - xgB), 0.9); // saturate: no 7-0 picks
  let bA = xgA, bB = xgB;
  if (xgA > xgB) bA = Math.min(xgA * (1 + 0.6 * gap), 3.4);
  else if (xgB > xgA) bB = Math.min(xgB * (1 + 0.6 * gap), 3.4);
  const boosted = scoreDistribution(bA, bB);
  const outcomeOf = (c) => c.a > c.b ? "A" : (c.a < c.b ? "B" : "D");
  // Condition on the UNBOOSTED favourite outcome so the headline never
  // contradicts the probability bar.
  return boosted.cells.find(c => outcomeOf(c) === baseDist.favOutcome) || baseDist.pick;
}

// ---------------------------------------------------------------------------
// GOAL TIMING — when in the game does each style actually score?
// Share of a team's goals per window (heuristic priors, modern-era tendencies):
// pressing sides start fast and fade as legs go; possession sides wear
// opponents down and peak late; low blocks live off late set pieces and
// sucker-punches; direct teams tilt slightly first-half while fresh.
// Used to answer "how likely has X scored BY minute m" — combine the team's
// match xG with the cumulative share of its goals that arrive by then.
// ---------------------------------------------------------------------------
const TIMING_WINDOWS = [
  { s: 0,  e: 22, label: "0-22'" },
  { s: 22, e: 45, label: "23-45'" },
  { s: 45, e: 75, label: "46-75'" },
  { s: 75, e: 95, label: "76-90'+" },
];
const STYLE_GOAL_TIMING = {
  PRESS:      [0.30, 0.26, 0.24, 0.20],
  COUNTER:    [0.20, 0.25, 0.26, 0.29],
  POSSESSION: [0.17, 0.24, 0.28, 0.31],
  PARK_BUS:   [0.15, 0.24, 0.26, 0.35],
  DIRECT:     [0.25, 0.28, 0.24, 0.23],
  TOTAL:      [0.24, 0.26, 0.26, 0.24],
  BALANCED:   [0.22, 0.26, 0.26, 0.26],
};

// ...and when does each style CONCEDE? Independent signal from scoring:
// pressing sides are hardest to play through early but their legs die late;
// low blocks hold shape for an hour then crack under sustained siege (and
// set pieces) — while high-line styles (total/possession) give up transition
// chances all game, including early before the press settles.
const STYLE_CONCEDE_TIMING = {
  PRESS:      [0.15, 0.22, 0.27, 0.36],
  COUNTER:    [0.20, 0.26, 0.27, 0.27],
  POSSESSION: [0.24, 0.25, 0.25, 0.26],
  PARK_BUS:   [0.14, 0.22, 0.28, 0.36],
  DIRECT:     [0.22, 0.26, 0.26, 0.26],
  TOTAL:      [0.26, 0.25, 0.24, 0.25],
  BALANCED:   [0.23, 0.26, 0.26, 0.25],
};

function cumulativeShare(weights, minute) {
  let acc = 0;
  for (let i = 0; i < TIMING_WINDOWS.length; i++) {
    const { s, e } = TIMING_WINDOWS[i];
    if (minute >= e) acc += weights[i];
    else if (minute > s) { acc += weights[i] * (minute - s) / (e - s); break; }
    else break;
  }
  return Math.min(1, acc);
}

// ---------------------------------------------------------------------------
// TEAM-SPECIFIC timing, built from REAL goal minutes recorded in RESULTS
// (each entry may carry goalsA / goalsB = arrays of minute integers). We scan
// every completed game a team played, bucket its own goals (scored) and the
// opponent's goals (conceded) into the four windows, and blend the observed
// shares with the style prior. Per the user's spec: aim for 75% the team's
// OWN pattern / 25% the style prior — but a team needs a real sample to earn
// that weight, so realWeight = 0.75 * min(1, n/5) (needs ~5 goals of that
// kind to reach the full 75%). No data → 100% prior, so nothing breaks before
// the minutes are populated.
// ---------------------------------------------------------------------------
function binMinute(m) {
  for (let i = 0; i < TIMING_WINDOWS.length; i++) {
    if (m <= TIMING_WINDOWS[i].e) return i;
  }
  return TIMING_WINDOWS.length - 1; // 90+X stoppage/ET lumps into the last window
}

const teamTimingCache = {};
function teamRealTiming(name) {
  if (teamTimingCache[name]) return teamTimingCache[name];
  const scored = [0, 0, 0, 0], conceded = [0, 0, 0, 0];
  let nS = 0, nC = 0;
  const addScored = m => { scored[binMinute(m)]++; nS++; };
  const addConceded = m => { conceded[binMinute(m)]++; nC++; };

  // Group-stage minutes (scored grouped by game, conceded flat)
  const g = typeof GROUP_GOAL_MINS !== "undefined" ? GROUP_GOAL_MINS[name] : null;
  if (g) {
    (g.scoredByGame || []).forEach(game => game.forEach(addScored));
    (g.concededMins || []).forEach(addConceded);
  }
  // Knockout-round minutes (per-game, on RESULTS entries)
  RESULTS.forEach(r => {
    if (r.scoreA === null) return;
    const mine = r.a === name, theirs = r.b === name;
    if (!mine && !theirs) return;
    const myGoals = mine ? r.goalsA : r.goalsB;
    const oppGoals = mine ? r.goalsB : r.goalsA;
    if (Array.isArray(myGoals)) myGoals.forEach(addScored);
    if (Array.isArray(oppGoals)) oppGoals.forEach(addConceded);
  });

  const norm = (arr, n) => n > 0 ? arr.map(v => v / n) : null;
  const out = { scored: norm(scored, nS), conceded: norm(conceded, nC), nS, nC };
  teamTimingCache[name] = out;
  return out;
}

function blendCurve(realShare, n, prior) {
  if (!realShare || n === 0) return prior;
  const w = 0.75 * Math.min(1, n / 5);
  return prior.map((p, i) => w * realShare[i] + (1 - w) * p);
}
function effScoreCurve(name, style) {
  const t = teamRealTiming(name);
  return blendCurve(t.scored, t.nS, STYLE_GOAL_TIMING[style] || STYLE_GOAL_TIMING.BALANCED);
}
function effConcedeCurve(name, style) {
  const t = teamRealTiming(name);
  return blendCurve(t.conceded, t.nC, STYLE_CONCEDE_TIMING[style] || STYLE_CONCEDE_TIMING.BALANCED);
}

// Fraction of A-scores-against-B goals that arrive by `minute`: a goal needs
// both an attacker in a scoring window AND a defender in a conceding window,
// so blend A's (team-specific) scoring curve with B's conceding curve.
function goalShareByMinute(atkName, atkStyle, minute, defName, defStyle) {
  const atk = cumulativeShare(effScoreCurve(atkName, atkStyle), minute);
  if (!defName) return atk;
  const def = cumulativeShare(effConcedeCurve(defName, defStyle), minute);
  return 0.5 * atk + 0.5 * def;
}

// P(team has scored at least once by `minute`), given its match xG, its own
// scoring timing, and the opponent's conceding timing.
function scoreByMinuteProb(lam, atkName, atkStyle, minute, defName, defStyle) {
  return 1 - Math.exp(-lam * goalShareByMinute(atkName, atkStyle, minute, defName, defStyle));
}

function peakOf(weights) {
  let bi = 0;
  weights.forEach((v, i) => { if (v > weights[bi]) bi = i; });
  return { label: TIMING_WINDOWS[bi].label, pct: Math.round(weights[bi] * 100) };
}
function peakWindow(name, style) { return peakOf(effScoreCurve(name, style)); }
function peakConcedeWindow(name, style) { return peakOf(effConcedeCurve(name, style)); }

// The "Bayern effect": does this team score in BURSTS? Scan each of its games'
// own-goal minutes; count how many goals landed within 10' of a previous goal
// of ITS OWN in the same game. A high rate = "once they score, another tends
// to follow fast" — a real, exploitable knockout pattern. Needs ≥3 goals total
// across games to say anything; below that, returns null (honest about sample).
function teamClustering(name) {
  let clustered = 0, eligible = 0, total = 0;
  const scanGame = (goals) => {
    if (!Array.isArray(goals) || goals.length === 0) return;
    const sorted = [...goals].sort((x, y) => x - y);
    total += sorted.length;
    for (let i = 1; i < sorted.length; i++) {
      eligible++;
      if (sorted[i] - sorted[i - 1] <= 10) clustered++;
    }
  };
  // Group games (per-game arrays)
  const g = typeof GROUP_GOAL_MINS !== "undefined" ? GROUP_GOAL_MINS[name] : null;
  if (g) (g.scoredByGame || []).forEach(scanGame);
  // Knockout games (per-game, on RESULTS)
  RESULTS.forEach(r => {
    if (r.scoreA === null) return;
    const mine = r.a === name, theirs = r.b === name;
    if (!mine && !theirs) return;
    scanGame(mine ? r.goalsA : theirs ? r.goalsB : null);
  });
  if (total < 3) return null;
  const rate = eligible > 0 ? clustered / eligible : 0;
  // Strong bar for the badge: at least 3 quick-follow goals AND a majority of
  // follow-ups clustered. On small tournament samples a rate of 0.4 on 5 pairs
  // is noise; 3+ clustered instances is a genuine "they score in flurries"
  // signature (the user's Bayern pattern). Weaker leans are exposed via `rate`
  // for callers that want to mention them without badging.
  return { rate, clustered, eligible, total, bursty: rate >= 0.5 && clustered >= 3 };
}

// ---------------------------------------------------------------------------
// GAME-STATE ENGINE (heuristic, modern-era tendencies)
// ---------------------------------------------------------------------------

// How much a LEADING team keeps attacking (multiplier on its base goal rate).
const LEADER_PUSH   = { POSSESSION: 0.95, PRESS: 1.00, COUNTER: 1.15, PARK_BUS: 0.55, DIRECT: 0.90, TOTAL: 1.00, BALANCED: 0.85 };
// How good a leading team's defensive shell is (multiplier on trailer's rate; lower = tougher to break down).
const DEF_SHELL     = { POSSESSION: 0.90, PRESS: 1.00, COUNTER: 0.85, PARK_BUS: 0.70, DIRECT: 1.05, TOTAL: 1.00, BALANCED: 0.85 };
// How many bodies a TRAILING team commits forward (>1 = concedes space in behind).
const TRAILER_COMMIT= { POSSESSION: 1.30, PRESS: 1.25, COUNTER: 1.05, PARK_BUS: 1.15, DIRECT: 1.20, TOTAL: 1.35, BALANCED: 1.15 };
// A trailing team's own goal threat when chasing (bus teams chase badly).
const TRAILER_THREAT= { POSSESSION: 1.35, PRESS: 1.30, COUNTER: 1.10, PARK_BUS: 0.75, DIRECT: 1.10, TOTAL: 1.40, BALANCED: 1.15 };
// How well the leading team punishes the space a chasing opponent leaves.
const COUNTER_ABILITY={ COUNTER: 1.00, PRESS: 0.70, DIRECT: 0.60, TOTAL: 0.50, POSSESSION: 0.45, BALANCED: 0.45, PARK_BUS: 0.55 };

// Expected additional goals for each side over `minutesLeft`, given a lead.
function projectState(leader, trailer, leaderGoals, trailerGoals, minutesLeft, lamLeader, lamTrailer) {
  const rateL = lamLeader / 95;
  const rateT = lamTrailer / 95;
  const lead = leaderGoals - trailerGoals;

  const kill = lead >= 3 ? 0.68 : lead === 2 ? 0.82 : 1.0; // 2+ goal leads get managed
  const urg  = lead >= 3 ? 0.85 : lead === 2 ? 1.05 : 1.0; // trailer urgency

  const commit = TRAILER_COMMIT[trailer.style] * urg;
  const threat = TRAILER_THREAT[trailer.style] * urg;
  const spaceOpened = Math.max(0, commit - 1);

  const addTrailer = rateT * threat * DEF_SHELL[leader.style] * minutesLeft;
  const addLeader  = rateL * LEADER_PUSH[leader.style] * kill *
                     (1 + spaceOpened * COUNTER_ABILITY[leader.style] * 2.2) * minutesLeft;

  return { addLeader: clamp(addLeader, 0, 4), addTrailer: clamp(addTrailer, 0, 4) };
}

function scenarioNote(leader, trailer, leaderName, trailerName) {
  const managing = leader.style === "PARK_BUS" || leader.style === "BALANCED";
  const puncher  = leader.style === "COUNTER" || leader.style === "PRESS";
  const busTrailer = trailer.style === "PARK_BUS";

  if (puncher && busTrailer)
    return `${trailerName} is forced out of its low block to chase — conceding exactly the space ${leaderName} thrives in. Expect ${leaderName}'s numbers to climb, not stall.`;
  if (managing)
    return `${leaderName} will likely drop deeper to protect the lead — few further goals expected, and a nervy finish if ${trailerName} can push bodies forward.`;
  if (leader.style === "POSSESSION" || leader.style === "TOTAL")
    return `${leaderName} keeps the ball to control the game rather than counter — more likely to add a second through sustained pressure than a quick break.`;
  if (busTrailer)
    return `${trailerName} has to abandon its shell and commit forward, which opens the game up in ${leaderName}'s favour.`;
  return `${trailerName} pushes up to chase the game, leaving gaps that make further goals — at either end — more likely.`;
}

// ---------------------------------------------------------------------------
// Reasoning blurbs (style-vs-style narrative)
// ---------------------------------------------------------------------------
const REASON_TEMPLATES = {
  "COUNTER_POSSESSION": "{B} likes to dominate the ball — exactly what {A}'s counter-attacking setup wants. Expect {A} to sit off and hit {B} on the break.",
  "PRESS_POSSESSION": "{A}'s high press should disrupt {B}'s rhythm in the build-up, forcing turnovers in dangerous areas.",
  "PARK_BUS_PRESS": "{A}'s low block is built to frustrate exactly this kind of high-press team — {B} may dominate territory without creating much.",
  "PARK_BUS_POSSESSION": "{A} will sit deep and cede possession to {B}, betting on discipline and set pieces over open, patient build-up.",
  "PARK_BUS_TOTAL": "{B}'s fluid rotations usually create overloads, but {A}'s deep block is drilled precisely to deny that space.",
  "TOTAL_PARK_BUS": "{A} will need patience — disciplined low blocks like {B}'s have troubled fluid attacking sides before.",
  "DIRECT_POSSESSION": "{A} will look to bypass {B}'s neat build-up with physicality and direct balls into the box.",
  "COUNTER_TOTAL": "{B}'s high line invites exactly the kind of pace-on-the-break threat {A} thrives on.",
  "PARK_BUS_COUNTER": "Two teams happy to play in transition rather than dominate the ball — expect a cagey, low-event game where the first goal matters enormously.",
  "COUNTER_PARK_BUS": "{B} will sit in a low block and try to deny space in behind — {A} will need patience to prise open a well-organized defense.",
  "PRESS_COUNTER": "{B} is dangerous in transition, so {A}'s high press carries risk — lose the ball in the wrong area and {B} can hurt them in the space left behind.",
};

// Human-readable line about how each side's creative trio should fare against
// this specific opponent's approach — only surfaced when it's non-trivial.
function creativityNote(nameA, teamA, nameB, teamB) {
  const notes = [];
  [[nameA, teamB.style, teamB], [nameB, teamA.style, teamA]].forEach(([name, oppStyle]) => {
    const c = teamCreativity(name);
    if (c == null) return;
    const mul = creativityXgMul(name, oppStyle);
    const top = PLAYMAKERS[name][0].name;
    if (mul >= 1.045) notes.push(`${top} and ${name}'s creative trio (avg ${c.toFixed(1)}) should have real time on the ball against a ${STYLES[oppStyle].label.toLowerCase()} approach that doesn't press hard — expect them to influence the game.`);
    else if (mul <= 0.975) notes.push(`${top} tends to get shut down by exactly this kind of ${STYLES[oppStyle].label.toLowerCase()} approach — physical, early engagement gives creative players like this far less room to operate.`);
  });
  return notes.join(" ");
}

function reasoningFor(a, b, teamA, teamB) {
  const key1 = `${teamA.style}_${teamB.style}`;
  const key2 = `${teamB.style}_${teamA.style}`;
  if (REASON_TEMPLATES[key1]) return REASON_TEMPLATES[key1].replace(/{A}/g, a).replace(/{B}/g, b);
  if (REASON_TEMPLATES[key2]) return REASON_TEMPLATES[key2].replace(/{A}/g, b).replace(/{B}/g, a);
  // Use the full blended rating (strength+momentum+form), not raw strength —
  // otherwise this line can contradict the probability bar next to it.
  const stronger = effectiveRating(teamA) >= effectiveRating(teamB) ? a : b;
  return `No sharp stylistic edge either way here — this one likely comes down to individual quality, and ${stronger} carries the higher overall rating into kickoff.`;
}

// How much should the user trust this pick? Two ingredients:
//   1. Edge size — a 55/45 lean is inside the model's noise; 75/25 isn't.
//   2. Signal coherence — when long-term strength, current-era momentum, and
//      tournament form all point at the same team, the pick is robust; when
//      they argue with each other (e.g. strong squad, poor tournament), any
//      single number hides real uncertainty.
// Names which of the three quality signals (strength / momentum / form) favour
// each side — this is what makes a low-confidence call actionable instead of
// just "shrug". Returns e.g. { favA:["strength","momentum"], favB:["form"] }.
function signalSplit(teamA, teamB) {
  const momA = teamA.momentum != null ? teamA.momentum : teamA.strength;
  const momB = teamB.momentum != null ? teamB.momentum : teamB.strength;
  const rows = [["strength", teamA.strength, teamB.strength], ["momentum", momA, momB], ["form", teamA.form, teamB.form]];
  const favA = [], favB = [];
  rows.forEach(([label, a, b]) => { if (a > b) favA.push(label); else if (b > a) favB.push(label); });
  return { favA, favB };
}

// Is there an orthogonal tactical edge (pace-vs-line) big enough to break a
// deadlock? Returns a short phrase naming it, or null.
function tacticalTiebreaker(nameA, nameB) {
  const mA = paceLineMul(nameA, nameB), mB = paceLineMul(nameB, nameA);
  const net = mA - mB; // >0 means A's pace-vs-line edge outweighs B's
  if (Math.abs(net) < 0.04) return null;
  const beneficiary = net > 0 ? nameA : nameB;
  return `${beneficiary}'s pace-vs-line edge is the one orthogonal tiebreaker leaning in`;
}

function predictionConfidence(nameA, nameB, teamA, teamB, dist) {
  const edge = Math.abs(dist.winA - dist.winB);
  const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const favSign = sgn(dist.winA - dist.winB);
  const momA = teamA.momentum != null ? teamA.momentum : teamA.strength;
  const momB = teamB.momentum != null ? teamB.momentum : teamB.strength;
  const signals = [sgn(teamA.strength - teamB.strength), sgn(momA - momB), sgn(teamA.form - teamB.form)];
  const agree = signals.filter(s => s === favSign && s !== 0).length;
  const conflict = signals.filter(s => s === -favSign && s !== 0).length;

  const { favA, favB } = signalSplit(teamA, teamB);
  const splitStr = (favA.length && favB.length)
    ? `${favA.join("+")} favour ${nameA}, ${favB.join("+")} favour ${nameB}`
    : null;
  const tb = tacticalTiebreaker(nameA, nameB);

  if (edge >= 0.25 && conflict === 0 && agree >= 2)
    return { level: "High", why: "Clear edge, and strength, momentum and tournament form all point the same way." };

  // Low confidence: say EXACTLY what's missing/conflicting, and whether any
  // orthogonal signal breaks the tie — that's the actionable part.
  if (edge < 0.08 || conflict >= 2) {
    let why = splitStr
      ? `Quality signals split — ${splitStr} — so they cancel to a coin-flip.`
      : "Near coin-flip — the edge is smaller than the model's own noise.";
    why += tb ? ` ${tb}, but it's slim.` : " No tactical tiebreaker separates them — this is a genuine toss-up.";
    return { level: "Low", why };
  }

  const why = conflict === 1 && splitStr
    ? `Solid edge, but the signals aren't unanimous — ${splitStr}.${tb ? " " + tb + "." : ""}`
    : "Moderate edge — leans real, but not decisive.";
  return { level: "Medium", why };
}

// ---------------------------------------------------------------------------
// Per-team illustrative stats (seeded, consistent with style + strength)
// ---------------------------------------------------------------------------
function hashSeed(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h >>> 0; }
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLE_STAT_BASE = {
  POSSESSION: { possession: 64, passAccuracy: 89, shotsOnTarget: 5.4, bigChances: 3.2, recoveries: 14, goalsConceded: 0.9, cleanSheetPct: 45, duelsWonPct: 47 },
  PRESS:      { possession: 55, passAccuracy: 85, shotsOnTarget: 5.0, bigChances: 2.8, recoveries: 22, goalsConceded: 1.1, cleanSheetPct: 38, duelsWonPct: 54 },
  COUNTER:    { possession: 46, passAccuracy: 84, shotsOnTarget: 4.7, bigChances: 2.6, recoveries: 15, goalsConceded: 1.0, cleanSheetPct: 40, duelsWonPct: 52 },
  PARK_BUS:   { possession: 36, passAccuracy: 80, shotsOnTarget: 3.0, bigChances: 1.6, recoveries: 12, goalsConceded: 0.6, cleanSheetPct: 58, duelsWonPct: 56 },
  DIRECT:     { possession: 44, passAccuracy: 78, shotsOnTarget: 4.2, bigChances: 2.0, recoveries: 13, goalsConceded: 1.2, cleanSheetPct: 34, duelsWonPct: 60 },
  TOTAL:      { possession: 61, passAccuracy: 90, shotsOnTarget: 5.8, bigChances: 3.5, recoveries: 20, goalsConceded: 0.8, cleanSheetPct: 50, duelsWonPct: 55 },
  BALANCED:   { possession: 52, passAccuracy: 85, shotsOnTarget: 4.8, bigChances: 2.7, recoveries: 16, goalsConceded: 1.0, cleanSheetPct: 44, duelsWonPct: 50 },
};

const STAT_META = [
  { key: "possession",    label: "Possession",                 unit: "%", higherBetter: true },
  { key: "passAccuracy",  label: "Pass Accuracy",              unit: "%", higherBetter: true },
  { key: "shotsOnTarget", label: "Shots on Target / game",     unit: "",  higherBetter: true },
  { key: "bigChances",    label: "Big Chances Created / game", unit: "",  higherBetter: true },
  { key: "recoveries",    label: "High Recoveries / game",     unit: "",  higherBetter: true },
  { key: "goalsConceded", label: "Goals Conceded / game",      unit: "",  higherBetter: false },
  { key: "cleanSheetPct", label: "Clean Sheet Rate",           unit: "%", higherBetter: true },
  { key: "duelsWonPct",   label: "Duels Won",                  unit: "%", higherBetter: true },
];

const statsCache = {};
function generateStats(teamName) {
  if (statsCache[teamName]) return statsCache[teamName];
  const team = TEAMS[teamName];
  const base = STYLE_STAT_BASE[team.style];
  const rng = mulberry32(hashSeed(teamName));
  const strengthAdj = (team.strength - 78) / 10;
  const stats = {};
  STAT_META.forEach(({ key, higherBetter }) => {
    const noise = (rng() - 0.5) * (base[key] * 0.12);
    const direction = higherBetter ? 1 : -1;
    let v = base[key] + direction * strengthAdj * (base[key] * 0.05) + noise;
    if (["possession", "passAccuracy", "cleanSheetPct", "duelsWonPct"].includes(key)) v = clamp(v, 20, 80);
    else if (key === "goalsConceded") v = clamp(v, 0.2, 2.5);
    else v = clamp(v, 0.5, 8);
    stats[key] = v;
  });
  statsCache[teamName] = stats;
  return stats;
}

function formatStat(value, key) {
  if (["shotsOnTarget", "bigChances", "recoveries", "goalsConceded"].includes(key)) return value.toFixed(1);
  return Math.round(value).toString();
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function predictMatch(nameA, nameB, opts = {}) {
  const teamA = TEAMS[nameA];
  const teamB = TEAMS[nameB];
  if (!teamA || !teamB) return null;

  const [xgA, xgB] = expectedGoals(nameA, nameB, opts);
  const dist = scoreDistribution(xgA, xgB);

  const headline = pickHeadline(xgA, xgB, dist);
  const scoreA = headline.a;
  const scoreB = headline.b;

  // Build the game-state scenarios. Favourite = higher win probability.
  const favIsA = dist.winA >= dist.winB;
  const favName = favIsA ? nameA : nameB;
  const favTeam = favIsA ? teamA : teamB;
  const undName = favIsA ? nameB : nameA;
  const undTeam = favIsA ? teamB : teamA;
  const lamFav = favIsA ? xgA : xgB;
  const lamUnd = favIsA ? xgB : xgA;

  const mk = (leaderName, leaderTeam, trailerName, trailerTeam, lg, tg, minsLeft, lamL, lamT, minuteMark, title) => {
    const pr = projectState(leaderTeam, trailerTeam, lg, tg, minsLeft, lamL, lamT);
    // How plausible is this scenario's premise — has each side usually
    // scored by this point, given its xG, its scoring windows, AND when the
    // opponent tends to concede?
    const pL = Math.round(scoreByMinuteProb(lamL, leaderName, leaderTeam.style, minuteMark, trailerName, trailerTeam.style) * 100);
    const pT = Math.round(scoreByMinuteProb(lamT, trailerName, trailerTeam.style, minuteMark, leaderName, leaderTeam.style) * 100);
    return {
      title,
      line: `${leaderName} +${pr.addLeader.toFixed(1)} · ${trailerName} +${pr.addTrailer.toFixed(1)}`,
      projected: `${leaderName} ${lg + Math.round(pr.addLeader)}–${tg + Math.round(pr.addTrailer)} ${trailerName}`,
      byThen: `Odds to have scored by ${minuteMark}': ${leaderName} ${pL}% · ${trailerName} ${pT}%`,
      note: scenarioNote(leaderTeam, trailerTeam, leaderName, trailerName),
    };
  };

  const scenarios = [
    mk(favName, favTeam, undName, undTeam, 1, 0, 62, lamFav, lamUnd, 30, `If ${favName} (favourite) leads 1–0 at ~30'`),
    mk(undName, undTeam, favName, favTeam, 1, 0, 62, lamUnd, lamFav, 30, `If ${undName} (underdog) leads 1–0 at ~30'`),
    mk(favName, favTeam, undName, undTeam, 2, 0, 32, lamFav, lamUnd, 60, `If ${favName} leads 2–0 at ~60'`),
  ];

  let reasoning = reasoningFor(nameA, nameB, teamA, teamB);
  const formGap = teamA.form - teamB.form;
  if (Math.abs(formGap) >= 6) {
    const inForm = formGap > 0 ? teamA : teamB;
    const inFormName = formGap > 0 ? nameA : nameB;
    reasoning += ` Tournament form also points to ${inFormName}: ${inForm.formNote}`;
  }
  const creativity = creativityNote(nameA, teamA, nameB, teamB);

  return {
    teamA, teamB,
    xgA, xgB,
    winProbA: dist.winA, drawProb: dist.draw, winProbB: dist.winB,
    scoreA, scoreB,
    topScores: dist.top,
    scenarios,
    statsA: generateStats(nameA),
    statsB: generateStats(nameB),
    creativityA: teamCreativity(nameA),
    creativityB: teamCreativity(nameB),
    creativityNote: creativity,
    confidence: predictionConfidence(nameA, nameB, teamA, teamB, dist),
    timingA: peakWindow(nameA, teamA.style),
    timingB: peakWindow(nameB, teamB.style),
    concedeA: peakConcedeWindow(nameA, teamA.style),
    concedeB: peakConcedeWindow(nameB, teamB.style),
    paceLine: paceMatchupNote(nameA, nameB),
    clusterA: teamClustering(nameA),
    clusterB: teamClustering(nameB),
    timingSampleA: teamRealTiming(nameA).nS,
    timingSampleB: teamRealTiming(nameB).nS,
    penaltiesLikely: dist.draw > 0.26,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// MOMENTUM — computed from MOMENTUM_PEDIGREE (data.js) instead of hand-set:
//   65% WC qualifiers + 25% tournament blend + 10% peer friendlies
// Tournament blend = 50/50 last major tournament and Nations League; if a
// confederation only has one of the two (CONMEBOL/CAF have no NL, Norway
// missed Euro 2024), the one that exists takes the full 25%. Hosts played no
// qualifiers, so their split becomes 60% tournament blend + 40% friendlies —
// those genuinely are the only competitive matches they've had.
// ---------------------------------------------------------------------------
function computeMomentum(name) {
  const p = typeof MOMENTUM_PEDIGREE !== "undefined" ? MOMENTUM_PEDIGREE[name] : null;
  if (!p) return null;
  const tournBlend = (p.tourn != null && p.nl != null) ? 0.5 * p.tourn + 0.5 * p.nl
                   : (p.tourn != null ? p.tourn : p.nl);
  if (p.hostNoQual) return Math.round(clamp(0.6 * tournBlend + 0.4 * p.fr, 0, 100));
  return Math.round(clamp(0.65 * p.qual + 0.25 * tournBlend + 0.10 * p.fr, 0, 100));
}

function applyComputedMomentum() {
  for (const name of Object.keys(TEAMS)) {
    const m = computeMomentum(name);
    if (m != null) TEAMS[name].momentum = m; // teams without pedigree data keep their hand-set value
  }
}

// Build the tournament model once, as soon as the scripts load.
applyComputedMomentum();
computeTournamentModel();
