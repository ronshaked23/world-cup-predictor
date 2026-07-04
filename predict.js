// ---------------------------------------------------------------------------
// Prediction engine
// A lightweight heuristic model (NOT real analytics) combining:
//   1. Team strength rating
//   2. A rock-paper-scissors style matchup bonus between playstyles
//   3. A Poisson goal model (the same basic technique real sportsbooks use
//      for "correct score" markets) to rank likely scorelines
// Purely for fun — clearly labelled as such in the UI.
// ---------------------------------------------------------------------------

// matchupBonus(attackerStyle, opponentStyle) -> points added to the
// attacker's effective rating for this particular matchup.
const MATCHUP_TABLE = {
  COUNTER:  { POSSESSION: 4, PRESS: -3, PARK_BUS: 2, DIRECT: 0, TOTAL: -2, BALANCED: 2, COUNTER: 0 },
  PRESS:    { POSSESSION: 4, PARK_BUS: -5, DIRECT: 2, TOTAL: -2, COUNTER: 3, BALANCED: 1, PRESS: 0 },
  POSSESSION: { PRESS: -4, DIRECT: 3, PARK_BUS: -6, TOTAL: -3, COUNTER: -3, BALANCED: 1, POSSESSION: 0 },
  PARK_BUS: { POSSESSION: 6, PRESS: 5, COUNTER: -2, DIRECT: 1, TOTAL: 4, BALANCED: 2, PARK_BUS: 0 },
  DIRECT:   { POSSESSION: -3, PRESS: -2, PARK_BUS: -1, TOTAL: -1, COUNTER: 0, BALANCED: 0, DIRECT: 0 },
  TOTAL:    { POSSESSION: 3, PRESS: 2, PARK_BUS: -4, DIRECT: 1, COUNTER: 2, BALANCED: 2, TOTAL: 0 },
  BALANCED: { POSSESSION: -1, PRESS: -1, PARK_BUS: -2, DIRECT: 0, COUNTER: -2, TOTAL: -2, BALANCED: 0 },
};

function matchupBonus(attackerStyle, opponentStyle) {
  return (MATCHUP_TABLE[attackerStyle] && MATCHUP_TABLE[attackerStyle][opponentStyle]) || 0;
}

// Reasoning blurb templates keyed by "ATTACKER_vs_OPPONENT"
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

function reasoningFor(a, b, teamA, teamB) {
  const key1 = `${teamA.style}_${teamB.style}`;
  const key2 = `${teamB.style}_${teamA.style}`;
  if (REASON_TEMPLATES[key1]) {
    return REASON_TEMPLATES[key1].replace(/{A}/g, a).replace(/{B}/g, b);
  }
  if (REASON_TEMPLATES[key2]) {
    return REASON_TEMPLATES[key2].replace(/{A}/g, b).replace(/{B}/g, a);
  }
  const stronger = teamA.strength >= teamB.strength ? a : b;
  return `No sharp stylistic edge either way here — this one likely comes down to individual quality, and ${stronger} carries the higher overall rating into kickoff.`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Deterministic per-team "form" stats, derived from style + strength rating
// so every number is consistent with the badge shown on the team's card.
// (Illustrative — this app has no live stats feed — but internally consistent
// and reproducible run to run, which is what makes them useful as talking
// points behind a prediction.)
// ---------------------------------------------------------------------------

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

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
  { key: "possession",    label: "Possession",            unit: "%",  higherBetter: true },
  { key: "passAccuracy",  label: "Pass Accuracy",         unit: "%",  higherBetter: true },
  { key: "shotsOnTarget", label: "Shots on Target / game", unit: "",  higherBetter: true },
  { key: "bigChances",    label: "Big Chances Created / game", unit: "", higherBetter: true },
  { key: "recoveries",    label: "High Recoveries / game", unit: "",  higherBetter: true },
  { key: "goalsConceded", label: "Goals Conceded / game",  unit: "",  higherBetter: false },
  { key: "cleanSheetPct", label: "Clean Sheet Rate",       unit: "%", higherBetter: true },
  { key: "duelsWonPct",   label: "Duels Won",              unit: "%", higherBetter: true },
];

const statsCache = {};

function generateStats(teamName) {
  if (statsCache[teamName]) return statsCache[teamName];
  const team = TEAMS[teamName];
  const base = STYLE_STAT_BASE[team.style];
  const rng = mulberry32(hashSeed(teamName));
  const strengthAdj = (team.strength - 78) / 10; // roughly -0.8 .. +1.4

  const stats = {};
  STAT_META.forEach(({ key, higherBetter }) => {
    const noise = (rng() - 0.5) * (base[key] * 0.12); // +/-6% style noise
    const direction = higherBetter ? 1 : -1;
    let v = base[key] + direction * strengthAdj * (base[key] * 0.05) + noise;
    if (key === "possession" || key === "passAccuracy" || key === "cleanSheetPct" || key === "duelsWonPct") {
      v = clamp(v, 20, 80);
    } else if (key === "goalsConceded") {
      v = clamp(v, 0.2, 2.5);
    } else {
      v = clamp(v, 0.5, 8);
    }
    stats[key] = v;
  });

  statsCache[teamName] = stats;
  return stats;
}

function formatStat(value, key) {
  if (key === "shotsOnTarget" || key === "bigChances" || key === "recoveries" || key === "goalsConceded") {
    return value.toFixed(1);
  }
  return Math.round(value).toString();
}

// ---------------------------------------------------------------------------
// Poisson goal model — same basic idea sportsbooks use for correct-score
// markets: treat each team's expected goals (xG) as a Poisson mean, then
// rank scorelines by joint probability.
// ---------------------------------------------------------------------------

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonP(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function topScorelines(xgA, xgB, topN = 3, maxGoals = 6) {
  const rows = [];
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      rows.push({ a: i, b: j, prob: poissonP(i, xgA) * poissonP(j, xgB) });
    }
  }
  rows.sort((x, y) => y.prob - x.prob);
  return rows.slice(0, topN);
}

// Effective rating blends long-term squad quality with how the team has
// actually looked in THIS tournament — knockout football rewards form.
function effectiveRating(team) {
  return 0.65 * team.strength + 0.35 * team.form;
}

// Returns { winProbA, winProbB, scoreA, scoreB, topScores, statsA, statsB, reasoning }
function predictMatch(nameA, nameB) {
  const teamA = TEAMS[nameA];
  const teamB = TEAMS[nameB];
  if (!teamA || !teamB) return null;

  const attackA = effectiveRating(teamA) + matchupBonus(teamA.style, teamB.style);
  const attackB = effectiveRating(teamB) + matchupBonus(teamB.style, teamA.style);

  const diff = attackA - attackB;
  const rawProbA = 1 / (1 + Math.pow(10, -diff / 22));
  const winProbA = clamp(rawProbA, 0.1, 0.9);
  const winProbB = 1 - winProbA;

  // Expected goals, loosely scaled off the rating gap, clamped to sane range
  const xgA = clamp(1.3 + diff / 22, 0.3, 3.2);
  const xgB = clamp(1.3 - diff / 22, 0.3, 3.2);

  const topScores = topScorelines(xgA, xgB, 3);
  const scoreA = topScores[0].a;
  const scoreB = topScores[0].b;

  const bothDefensive = teamA.style === "PARK_BUS" && teamB.style === "PARK_BUS";
  const closeMatch = Math.abs(diff) < 4;
  const penaltiesLikely = bothDefensive || (closeMatch && (teamA.style === "PARK_BUS" || teamB.style === "PARK_BUS"));

  // Tack a form observation onto the style-based reasoning when the two
  // sides have arrived at this game in clearly different shape.
  let reasoning = reasoningFor(nameA, nameB, teamA, teamB);
  const formGap = teamA.form - teamB.form;
  if (Math.abs(formGap) >= 6) {
    const inForm = formGap > 0 ? teamA : teamB;
    const inFormName = formGap > 0 ? nameA : nameB;
    reasoning += ` Tournament form also points to ${inFormName}: ${inForm.formNote}`;
  }

  return {
    teamA, teamB,
    winProbA, winProbB,
    scoreA, scoreB,
    topScores,
    statsA: generateStats(nameA),
    statsB: generateStats(nameB),
    penaltiesLikely,
    reasoning,
  };
}
