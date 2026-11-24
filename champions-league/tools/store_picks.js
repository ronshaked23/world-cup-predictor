#!/usr/bin/env node
// Save the coming matchday's Winner picks into data.js as m.bet, before
// kickoff, so finished games keep showing what was recommended (★ value /
// ◆ lean) and the site can grade them. Re-running replaces the saved picks
// for games that haven't been played yet; played games are never touched.
//
//   node champions-league/tools/store_picks.js
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "data.js");
let src = fs.readFileSync(file, "utf8");
eval(src + fs.readFileSync(path.join(__dirname, "..", "predict.js"), "utf8") + `
const upcoming = upcomingMatches();
if (!upcoming.length) { console.log("No upcoming games."); process.exit(0); }
const md = Math.min(...upcoming.map(m => m.md));
const games = upcoming.filter(m => m.md === md).map(m => { const c = { ...m }; delete c.bet; return c; });
const picks = dayPicks(games);
let n = 0;
games.forEach(m => {
  const re = new RegExp('(\\\\{ md: ' + md + ', h: "' + m.h + '", a: "' + m.a + '"(?!, hs:)[^\\\\n]*?)(, bet: \\\\[[^\\\\]]*\\\\])?( \\\\},?)$', "m");
  if (!re.test(src)) throw new Error("fixture line not found: " + m.h + " - " + m.a);
  const p = picks.get(oddsKey(m));
  src = src.replace(re, (all, body, oldBet, end) => body + (p ? ', bet: [' + p.i + ', ' + p.odds.toFixed(2) + ', "' + p.tier + '"]' : "") + end);
  if (p) { n++; console.log("  " + dayOf(m).padEnd(11) + (p.tier === "value" ? "★ " : "◆ ") + outcomeName(m, p.i) + " @ " + p.odds.toFixed(2) + " (" + (p.ev >= 0 ? "+" : "") + (p.ev * 100).toFixed(0) + "%)  " + m.h + " - " + m.a); }
});
fs.writeFileSync(file, src);
console.log("Saved " + n + " picks for matchday " + md + ".");
function outcomeName(m, i) { return i === 0 ? m.h : i === 2 ? m.a : "Draw"; }
`);
