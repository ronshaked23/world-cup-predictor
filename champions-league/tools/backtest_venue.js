#!/usr/bin/env node
// Backtest the home/away (venue) settings on every league-phase game played
// so far. For each game, both teams' venue form is rebuilt from games BEFORE
// that matchday, then we score the model's 1/X/2 probabilities against the
// result (log loss and Brier: lower is better). Team ratings are today's for
// every variant, so the comparison isolates the venue component.
//
//   node champions-league/tools/backtest_venue.js
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..");
eval(fs.readFileSync(path.join(dir, "data.js"), "utf8") + fs.readFileSync(path.join(dir, "predict.js"), "utf8") + `
const MD_START = { 1: "2026-09-08", 2: "2026-10-13", 3: "2026-10-20", 4: "2026-11-03", 5: "2026-11-24", 6: "2026-12-08", 7: "2027-01-19", 8: "2027-01-27" };
const BASE = { ...VENUE };
const VARIANTS = {
  "no team venue effect": { ...BASE, slope: 0 },
  "previous (points only, ±10%)": { league: 10, europe: 10, euroWeight: 1, goalWeight: 0, shrink: 4, slope: 0.12, cap: 0.10 },
  "current settings": { ...BASE },
  "points only, Europe x2": { ...BASE, goalWeight: 0 },
  "no Europe weight": { ...BASE, euroWeight: 1 },
  "stronger (±20%)": { ...BASE, slope: 0.25, cap: 0.20, shrink: 2 },
  "strongest (±25%)": { ...BASE, slope: 0.32, cap: 0.25, shrink: 1.5 },
};
const results = [];
for (const [label, cfg] of Object.entries(VARIANTS)) {
  Object.assign(VENUE, cfg);
  let ll = 0, brier = 0, hit = 0, n = 0;
  playedMatches().forEach(m => {
    const asOf = MD_START[m.md];
    RATINGS[m.h].venue = venueFormFor(m.h, asOf, cfg);
    RATINGS[m.a].venue = venueFormFor(m.a, asOf, cfg);
    for (const k in predictionCache) delete predictionCache[k];
    const p = predictMatch(m.h, m.a, m.md);
    const probs = [p.pH, p.pD, p.pA];
    const o = m.hs > m.as ? 0 : m.hs === m.as ? 1 : 2;
    ll += -Math.log(probs[o]);
    brier += probs.reduce((s, q, i) => s + Math.pow(q - (i === o ? 1 : 0), 2), 0);
    hit += probs.indexOf(Math.max(...probs)) === o ? 1 : 0;
    n++;
  });
  results.push({ label, ll: ll / n, brier: brier / n, hit, n });
}
Object.assign(VENUE, BASE);
console.log("variant".padEnd(32), "log loss", " Brier ", "right");
results.forEach(r => console.log(r.label.padEnd(32), r.ll.toFixed(4), " ", r.brier.toFixed(4), " ", r.hit + "/" + r.n));
`);
