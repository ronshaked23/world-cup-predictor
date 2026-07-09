// ---------------------------------------------------------------------------
// 2026 FIFA World Cup — snapshot data as of July 4, 2026 (Round of 16 kickoff)
// Sourced from live news coverage at build time. The tournament moves fast —
// edit RESULTS / FIXTURES below to keep it current as later rounds are played.
// ---------------------------------------------------------------------------

// Playstyle categories used to classify every team
const STYLES = {
  POSSESSION: { label: "Possession & Passing", color: "#2e7dd7" },
  PRESS:      { label: "Aggressive Press",      color: "#d1453b" },
  COUNTER:    { label: "Counter-Attack",        color: "#e08e0b" },
  PARK_BUS:   { label: "Park the Bus",          color: "#5a5f66" },
  DIRECT:     { label: "Direct & Physical",     color: "#8a4fd1" },
  TOTAL:      { label: "Total Football",        color: "#1fa774" },
  BALANCED:   { label: "Balanced / Pragmatic",  color: "#c9a227" },
};

// Every team that reached the Round of 32.
//   code     — ISO code for flag images (flagcdn.com)
//   strength — long-term squad quality / talent pool (0-100)
//   momentum — real-world record over roughly the last 18-24 months under the
//              CURRENT manager (0-100) — this is the layer that was missing
//              before: without it, a small in-tournament sample (form, below)
//              could swamp a team's genuine multi-year pedigree. Real Elo-style
//              systems get this "for free" because ratings carry over match to
//              match; here it's an explicit input since we start fresh per team.
//   form     — how good they've actually looked IN THIS TOURNAMENT ONLY (0-100),
//              with formNote citing the real results behind the number.
//   The prediction model blends strength (40%) + momentum (35%) + form (25%).
const TEAMS = {
  "Argentina":              { code: "ar", flag: "🇦🇷", strength: 92, momentum: 90, form: 93, style: "BALANCED",
    formNote: "Needed extra time to see off Cape Verde 3-2 in the round of 32 — a real scare after cruising the group stage, but Messi (now 7 goals) settled it late.",
    blurb: "Controls games through midfield discipline but happily drops deep and counters when ahead." },
  "France":                 { code: "fr", flag: "🇫🇷", strength: 91, momentum: 88, form: 93, style: "COUNTER",
    formNote: "Into the quarterfinals with the tournament's most feared attack (attack factor 1.67 — elite; Mbappé leading the golden boot race) after a 3-0 Sweden win and a grittier 1-0 over Paraguay. BUT Tchouaméni is OUT (adductor tear) for the Morocco QF, thinning the midfield shield.",
    blurb: "Doesn't need the ball — wins it back and breaks at pace through Mbappé/Olise. Ruthless in transition, but its speed can be smothered by a disciplined low block (see Morocco QF)." },
  "Spain":                  { code: "es", flag: "🇪🇸", strength: 90, momentum: 94, form: 92, style: "POSSESSION",
    formNote: "Into the quarterfinals having barely conceded all tournament (goals-against factor 0.53 — the best left) — a 1-0 win over Portugal sealed by Merino in the 90+1'. Without the injured Nico Williams, so more control than pace out wide.",
    blurb: "Modern tiki-taka: relentless short passing to suffocate opponents. Elite defensively too — but a VERY high line with slow fullbacks (no Carvajal) can be exploited in behind by real pace." },
  "Brazil":                 { code: "br", flag: "🇧🇷", strength: 88, momentum: 82, form: 84, style: "POSSESSION", eliminated: true,
    eliminatedNote: "Out — beaten 2-1 by Norway in the round of 16 (Haaland scored twice in the final 11 minutes); Neymar's stoppage-time penalty was too little too late.",
    formNote: "Only 2-1 past Japan in the round of 32 — a narrower, more laboured win than a title favorite would like — then blown past by Norway's late double in the round of 16.",
    blurb: "Technical, flair-driven possession built around quick combinations in tight spaces." },
  "England":                { code: "gb-eng", flag: "🏴", strength: 87, momentum: 93, form: 83, style: "BALANCED",
    formNote: "Edged DR Congo 2-1 — not pretty, but this side has barely lost a competitive match under its current manager in nearly two years.",
    blurb: "Patient build-up with license to go direct through pacey wide forwards." },
  "Portugal":               { code: "pt", flag: "🇵🇹", strength: 86, momentum: 88, form: 88, style: "COUNTER", eliminated: true,
    eliminatedNote: "Out — beaten 1-0 by Spain in the round of 16, Mikel Merino scoring an injury-time winner in the 90+1'. Cristiano Ronaldo's final World Cup ends without a trophy.",
    formNote: "Beat Croatia 2-1 — the standout head-to-head result of the round of 32.",
    blurb: "Compact defensively, explosive on the break with direct running in behind." },
  "Netherlands":            { code: "nl", flag: "🇳🇱", strength: 85, momentum: 82, form: 76, style: "TOTAL", eliminated: true,
    formNote: "Out — held 1-1 by Morocco and beaten 3-2 on penalties despite a goal-heavy group stage.",
    blurb: "Fluid positional rotations, high defensive line, everyone attacks and defends." },
  "Germany":                { code: "de", flag: "🇩🇪", strength: 83, momentum: 76, form: 74, style: "PRESS", eliminated: true,
    formNote: "Out — drew 1-1 with Paraguay and lost the shootout 4-3 in the round of 32.",
    blurb: "Coordinated high press aiming to win the ball in the opponent's third." },
  "Belgium":                { code: "be", flag: "🇧🇪", strength: 82, momentum: 78, form: 79, style: "COUNTER",
    formNote: "Survived a 3-2 extra-time thriller against Senegal — dangerous going forward, leaky at the back.",
    blurb: "Sits in a mid-block and springs quick vertical counters through creative midfielders." },
  "Croatia":                { code: "hr", flag: "🇭🇷", strength: 82, momentum: 79, form: 78, style: "POSSESSION", eliminated: true,
    formNote: "Out — competitive to the end but beaten 2-1 by Portugal.",
    blurb: "Wins the midfield battle first, controls tempo, patient in the final third." },
  "Uruguay":                { code: "uy", flag: "🇺🇾", strength: 82, momentum: 79, form: 72, style: "DIRECT", eliminated: true,
    eliminatedNote: "Out at the group stage — 2 points from 3 games (1 loss, 2 draws), sealed by a 0-1 defeat to Spain. Earliest World Cup exit for Uruguay since 2002.",
    formNote: "Out earlier than expected — a below-par tournament by its standards.",
    blurb: "Physical, combative, and disciplined defensively with quick vertical outlets." },
  "Colombia":               { code: "co", flag: "🇨🇴", strength: 81, momentum: 84, form: 82, style: "PRESS", eliminated: true,
    eliminatedNote: "Out — held Switzerland 0-0 through 120 minutes in the round of 16 before losing 4-3 on penalties (Sánchez off the woodwork).",
    formNote: "Beat Ghana 1-0 in the round of 32, dominating on the ball (61% possession, 2.06 xG) despite the tight scoreline — sets up a last-16 date with Switzerland.",
    blurb: "High-tempo pressing combined with individual flair in tight areas." },
  "Morocco":                { code: "ma", flag: "🇲🇦", strength: 80, momentum: 83, form: 87, style: "PARK_BUS",
    formNote: "Knocked out the Netherlands on penalties after a 1-1 draw — the defense has barely been breached all tournament, continuing its run since the 2022 semifinal.",
    blurb: "Elite defensive shape and discipline — happy to absorb pressure and strike once." },
  "Japan":                  { code: "jp", flag: "🇯🇵", strength: 79, momentum: 81, form: 80, style: "POSSESSION", eliminated: true,
    formNote: "Out — but pushed Brazil all the way in a 2-1 defeat after a strong group stage.",
    blurb: "Disciplined pressing triggers paired with quick, tidy possession football." },
  "USA":                    { code: "us", flag: "🇺🇸", strength: 78, momentum: 80, form: 83, style: "PRESS", eliminated: true,
    eliminatedNote: "Out — beaten 4-1 by Belgium in the round of 16 (De Ketelaere brace, Vanaken, Lukaku; Tillman replied), the last of the three co-hosts to be eliminated.",
    formNote: "Controlled 2-0 win over Bosnia — the press looks sharp and the home crowd is behind them.",
    blurb: "High-energy press for 90 minutes, wants to force turnovers high up the pitch." },
  "Senegal":                { code: "sn", flag: "🇸🇳", strength: 78, momentum: 76, form: 77, style: "COUNTER", eliminated: true,
    formNote: "Out — went toe-to-toe with Belgium in a 3-2 extra-time classic.",
    blurb: "Athletic and direct — breaks quickly through pace on the flanks." },
  "Switzerland":            { code: "ch", flag: "🇨🇭", strength: 78, momentum: 80, form: 82, style: "BALANCED",
    formNote: "Tidy 2-0 win over Algeria — still hasn't had to chase a game this tournament.",
    blurb: "Extremely well organized, rarely beaten twice, efficient rather than flashy." },
  "Mexico":                 { code: "mx", flag: "🇲🇽", strength: 77, momentum: 74, form: 84, style: "POSSESSION", eliminated: true,
    eliminatedNote: "Out — beaten 3-2 by England in the round of 16 at the Azteca, despite Quiñones and a Jiménez penalty pulling it back to 3-2; a red card to England's Quansah (54') wasn't enough to turn the tie. First-ever quarterfinal bid ends in the round of 16.",
    formNote: "Comfortable 2-0 over Ecuador at the Azteca, but that's against modest group opposition — this squad's underlying record over the last two years is solid CONCACAF-tier, not knockout-of-England tier — and it showed in a 3-2 round of 16 exit to England.",
    blurb: "Comfortable in possession, looks to control games at home in front of its crowd." },
  "Austria":                { code: "at", flag: "🇦🇹", strength: 77, momentum: 79, form: 70, style: "PRESS", eliminated: true,
    formNote: "Out — pressed high against Spain and was picked apart 3-0.",
    blurb: "Full-throttle gegenpressing in the mould of its coaching lineage." },
  "Ivory Coast":            { code: "ci", flag: "🇨🇮", strength: 76, momentum: 76, form: 75, style: "DIRECT", eliminated: true,
    formNote: "Out — led Norway 1-0 before conceding twice in a 2-1 defeat.",
    blurb: "Powerful and direct, wins physical duels and attacks crosses aggressively." },
  "Norway":                 { code: "no", flag: "🇳🇴", strength: 81, momentum: 79, form: 84, style: "DIRECT",
    formNote: "Came from behind to beat Ivory Coast 2-1 — and the betting markets rate this Haaland-led side as near-even money against Brazil.",
    blurb: "Built to get the ball to its target forward quickly and attack the box in numbers." },
  "Sweden":                 { code: "se", flag: "🇸🇪", strength: 76, momentum: 73, form: 68, style: "DIRECT", eliminated: true,
    formNote: "Out — swept aside 3-0 by France after a mixed group stage.",
    blurb: "Physical, set-piece dangerous, prefers a direct route over intricate build-up." },
  "Algeria":                { code: "dz", flag: "🇩🇿", strength: 76, momentum: 74, form: 71, style: "COUNTER", eliminated: true,
    formNote: "Out — never really threatened in a 2-0 defeat to Switzerland.",
    blurb: "Quick wide players punish teams that commit numbers forward." },
  "Ghana":                  { code: "gh", flag: "🇬🇭", strength: 75, momentum: 75, form: 74, style: "COUNTER", eliminated: true,
    eliminatedNote: "Out — beaten 1-0 by Colombia, outplayed territorially (39% possession, 0 shots on target).",
    formNote: "Lost 1-0 to Colombia in the round of 32 — competitive in the group stage but blunt in the final third when it mattered.",
    blurb: "Athletic transition play with pace to burn in behind stretched defenses." },
  "Canada":                 { code: "ca", flag: "🇨🇦", strength: 74, momentum: 79, form: 80, style: "PRESS", eliminated: true,
    eliminatedNote: "Out — beaten 3-0 by Morocco in the round of 16 (Ounahi brace, Rahimi), ending a landmark home run that included the country's first-ever World Cup knockout win.",
    formNote: "Ground out a 1-0 win over South Africa in front of a raucous home crowd, continuing a genuine multi-year rise — but the run ended in the round of 16.",
    blurb: "Aggressive, youthful press backed by direct running from its wide attackers." },
  "Egypt":                  { code: "eg", flag: "🇪🇬", strength: 74, momentum: 77, form: 76, style: "PARK_BUS", eliminated: true,
    eliminatedNote: "Out — led defending champions Argentina 2-0 (Ibrahim 15', Zico 67') before Argentina scored three in the final 11 minutes (Romero 79', Messi 83', Enzo Fernández 90+3') to win 3-2.",
    formNote: "Outlasted Australia on penalties after 1-1 — concedes little, creates little.",
    blurb: "Sits deep, defends in numbers, and leans on set pieces and moments of individual quality." },
  "Bosnia and Herzegovina": { code: "ba", flag: "🇧🇦", strength: 74, momentum: 72, form: 71, style: "DIRECT", eliminated: true,
    formNote: "Out — well beaten 2-0 by a sharper USA side.",
    blurb: "Physical and vertical, targets aerial duels and second balls." },
  "Paraguay":               { code: "py", flag: "🇵🇾", strength: 73, momentum: 75, form: 82, style: "PARK_BUS", eliminated: true,
    eliminatedNote: "Out — beaten 1-0 by France in the round of 16 (Mbappé penalty, 70'), managing just one shot on target. A fitting final chapter for the tournament's biggest overachiever.",
    formNote: "Stunned Germany on penalties after a 1-1 draw — the tournament's biggest overachiever, before running into France in the round of 16.",
    blurb: "Deep block, disciplined marking, banks on penalties and set pieces to advance." },
  "Australia":              { code: "au", flag: "🇦🇺", strength: 73, momentum: 73, form: 73, style: "PARK_BUS", eliminated: true,
    formNote: "Out — took Egypt to penalties but couldn't finish the job.",
    blurb: "Well-drilled low block that grinds out results rather than chasing the game." },
  "South Africa":           { code: "za", flag: "🇿🇦", strength: 72, momentum: 71, form: 71, style: "COUNTER", eliminated: true,
    formNote: "Out — kept it tight against Canada but lost 1-0.",
    blurb: "Compact defensively with quick breaks led by its wide forwards." },
  "Cape Verde":             { code: "cv", flag: "🇨🇻", strength: 70, momentum: 75, form: 76, style: "PARK_BUS", eliminated: true,
    eliminatedNote: "Out — took defending champions Argentina to extra time and very nearly the biggest shock of the tournament before losing 3-2.",
    formNote: "The tournament's surprise package — best qualifying campaign in its history, and it's carried straight into the finals.",
    blurb: "Tournament surprise package — organized, disciplined, and hard to break down." },
  "DR Congo":               { code: "cd", flag: "🇨🇩", strength: 71, momentum: 71, form: 73, style: "DIRECT", eliminated: true,
    formNote: "Out — gave England a real scare before falling 2-1.",
    blurb: "Physical and direct, relies on individual moments to unlock tight games." },
  "Ecuador":                { code: "ec", flag: "🇪🇨", strength: 76, momentum: 75, form: 72, style: "BALANCED", eliminated: true,
    formNote: "Out — shut down 2-0 by Mexico at the Azteca.",
    blurb: "Well-organized and athletic, comfortable adapting its approach to the opponent." },
};

// ---------------------------------------------------------------------------
// Top-3 playmakers per team (illustrative creativity ratings, 1-10) for the
// teams involved in currently-scheduled fixtures. Feeds the creativity/
// suppression system in predict.js — see CREATIVITY_SUPPRESSION there for how
// a team's creative talent is boosted or blunted by the opponent's playstyle
// (the "Olise vs a park-the-bus side" effect).
// ---------------------------------------------------------------------------
// RULE: only players who are actually AT this World Cup, regular starters
// (3+ games), and currently fit. Verified against squad/injury news July 6:
// Nico Williams (adductor injury, ruled out of the round of 16 vs Portugal;
// Dani Olmo starts in his place and takes the #3 creative slot).
// Rodrygo (ACL, never made the squad), Raphinha (hamstring, out vs Norway),
// Foden & Palmer (not in Tuchel's 26), Griezmann (retired from France duty
// 2024), Shaqiri (retired from Switzerland duty 2024) all removed.
const PLAYMAKERS = {
  "Argentina":   [{ name: "Messi", creativity: 9.8 }, { name: "Julián Álvarez", creativity: 8.6 }, { name: "Enzo Fernández", creativity: 8.4 }],
  "France":      [{ name: "Mbappé", creativity: 9.5 }, { name: "Dembélé", creativity: 9.0 }, { name: "Olise", creativity: 8.8 }],
  "Spain":       [{ name: "Lamine Yamal", creativity: 9.4 }, { name: "Pedri", creativity: 9.0 }, { name: "Dani Olmo", creativity: 8.6 }],
  "Brazil":      [{ name: "Vinícius Jr", creativity: 9.3 }, { name: "Paquetá", creativity: 8.2 }, { name: "Matheus Cunha", creativity: 8.0 }],
  "England":     [{ name: "Bellingham", creativity: 9.2 }, { name: "Saka", creativity: 8.9 }, { name: "Kane", creativity: 8.8 }],
  "Portugal":    [{ name: "Bruno Fernandes", creativity: 9.0 }, { name: "Bernardo Silva", creativity: 8.8 }, { name: "Leão", creativity: 8.3 }],
  "Mexico":      [{ name: "Alexis Vega", creativity: 7.5 }, { name: "Orbelín Pineda", creativity: 7.3 }, { name: "Santiago Giménez", creativity: 7.4 }],
  "Belgium":     [{ name: "De Bruyne", creativity: 8.9 }, { name: "Doku", creativity: 8.5 }, { name: "Trossard", creativity: 8.0 }],
  "USA":         [{ name: "Pulisic", creativity: 8.7 }, { name: "McKennie", creativity: 7.8 }, { name: "Weah", creativity: 7.7 }],
  "Egypt":       [{ name: "Salah", creativity: 9.0 }, { name: "Marmoush", creativity: 8.2 }, { name: "Zizo", creativity: 7.5 }],
  "Switzerland": [{ name: "Rieder", creativity: 7.8 }, { name: "Vargas", creativity: 7.6 }, { name: "Ndoye", creativity: 7.5 }],
  "Colombia":    [{ name: "Luis Díaz", creativity: 8.7 }, { name: "James Rodríguez", creativity: 8.6 }, { name: "Jhon Arias", creativity: 7.8 }],
  "Morocco":     [{ name: "Brahim Díaz", creativity: 8.7 }, { name: "Hakimi", creativity: 8.4 }, { name: "Amine Adli", creativity: 7.8 }],
  "Canada":      [{ name: "Alphonso Davies", creativity: 8.6 }, { name: "Jonathan David", creativity: 8.0 }, { name: "Ismaël Koné", creativity: 7.5 }],
  "Paraguay":    [{ name: "Almirón", creativity: 7.8 }, { name: "Enciso", creativity: 7.6 }, { name: "Ramón Sosa", creativity: 7.3 }],
  "Norway":      [{ name: "Ødegaard", creativity: 9.1 }, { name: "Nusa", creativity: 7.9 }, { name: "Bobb", creativity: 7.6 }],
  "Ghana":       [{ name: "Kudus", creativity: 8.6 }, { name: "Jordan Ayew", creativity: 7.5 }, { name: "Semenyo", creativity: 7.6 }],
  "Cape Verde":  [{ name: "Jamiro Monteiro", creativity: 7.2 }, { name: "Kenny Rocha Santos", creativity: 7.0 }, { name: "Willy Semedo", creativity: 6.9 }],
};

// ---------------------------------------------------------------------------
// MOMENTUM PEDIGREE — the raw components behind each team's momentum rating,
// computed in predict.js as:
//   65% WC qualifiers + 25% tournament blend + 10% peer friendlies
// where the tournament blend is 50/50 last major tournament (Euro/Copa/AFCON/
// Gold Cup) and Nations League — or 100% of whichever exists for
// confederations without both. Hosts (US/MX/CA) played no qualifiers, so
// their weights become 60% tournament blend + 40% friendlies.
// Subscores are 0-100, opponent-quality adjusted (a perfect run vs minnows
// caps lower than Norway's 8/8 that included a 4-1 away win in Italy).
// Friendlies only count vs opponents within ~20 ranking places.
// Sources: real records through Jan 2026 + AFCON 2025 verified via news.
// Only teams still alive on our board; eliminated teams keep hand-set values.
// ---------------------------------------------------------------------------
const MOMENTUM_PEDIGREE = {
  "England":     { qual: 97, tourn: 86, nl: 70, fr: 80,
    note: "Qualifiers: perfect 8W-0D-0L, 22-0 goals under Tuchel. Euro 2024 runners-up. NL 24-25 in League B (won group vs modest sides). Unbeaten vs peers in friendlies, thin sample." },
  "Spain":       { qual: 93, tourn: 96, nl: 90, fr: 85,
    note: "Unbeaten qualifying incl. 6-0 away in Türkiye. Euro 2024 champions. NL 24-25 runners-up (pens vs Portugal)." },
  "France":      { qual: 87, tourn: 78, nl: 82, fr: 82,
    note: "Topped qualifying group with a couple of stumbles (draw in Iceland). Euro 2024 semis but toothless in open play. NL 24-25 semifinalist (5-4 loss to Spain)." },
  "Portugal":    { qual: 84, tourn: 74, nl: 94, fr: 80,
    note: "Topped group but lost in Ireland (Ronaldo red). Euro 2024 QF pens exit. NL 24-25 CHAMPIONS — beat Spain in the June 2025 final." },
  "Belgium":     { qual: 80, tourn: 62, nl: 58, fr: 72,
    note: "Won a soft qualifying group after early draws. Euro 2024 R16 exit. Lost NL A/B playoff to Ukraine — relegated." },
  "Norway":      { qual: 97, tourn: null, nl: 74, fr: 76,
    note: "PERFECT 8/8 qualifying, 37-5 goals, beat Italy home AND 4-1 away, Haaland 16 goals. No Euro 2024 — first major since 2000, so NL (League B promotion) takes the full tournament weight." },
  "Switzerland": { qual: 91, tourn: 80, nl: 55, fr: 74,
    note: "Unbeaten qualifying, barely conceded. Euro 2024 QF (pens vs England). NL 24-25 relegated from League A (low confidence on details)." },
  "Argentina":   { qual: 93, tourn: 95, nl: null, fr: 88,
    note: "Topped CONMEBOL comfortably, sealed early. Copa 2024 champions. No NL in CONMEBOL — Copa takes the full 25%." },
  "Brazil":      { qual: 52, tourn: 60, nl: null, fr: 55,
    note: "WORST-ever qualifying campaign: 5th place, six defeats incl. 4-1 to Argentina, before Ancelotti stabilized things mid-2025. Copa 2024 QF pens exit. Lost 3-2 to Japan (Oct 2025) — first loss to Japan ever." },
  "Colombia":    { qual: 76, tourn: 88, nl: null, fr: 84,
    note: "Long unbeaten run through 2024, then a six-game winless slump, recovered strongly late 2025. Copa 2024 runners-up (aet vs Argentina). Strong late-2025 peer friendlies." },
  "Paraguay":    { qual: 70, tourn: 40, nl: null, fr: 68,
    note: "Qualified 6th — first World Cup since 2010, with home wins over Argentina and Brazil under Alfaro. But Copa 2024 was a winless group-stage exit." },
  "Morocco":     { qual: 92, tourn: 90, nl: null, fr: 84,
    note: "Perfect 6/6 qualifying — first team worldwide to qualify (modest opposition, capped). AFCON 2025 hosts: reached the final, lost 1-0 aet on the pitch to Senegal (later awarded the title by forfeit — we rate the on-pitch run). Long 2025 win streak." },
  "Egypt":       { qual: 87, tourn: 82, nl: null, fr: 72,
    note: "Dominant unbeaten qualifying, Salah top scorer. AFCON 2025 semifinalists — beat holders Ivory Coast, lost 1-0 to Senegal." },
  "Mexico":      { qual: null, hostNoQual: true, tourn: 90, nl: 88, fr: 62,
    note: "Host — no qualifiers. Gold Cup 2025 champions AND CONCACAF NL 24-25 champions. But 2025 peer friendlies were poor (incl. a 4-0 loss to Colombia)." },
  "USA":         { qual: null, hostNoQual: true, tourn: 74, nl: 55, fr: 60,
    note: "Host — no qualifiers. Gold Cup 2025 runners-up (with a B squad). NL 24-25: lost semi to Panama and the 3rd-place game to Canada. Rough 2025 friendlies (4-0 loss to Switzerland) improving late in the year." },
  "Canada":      { qual: null, hostNoQual: true, tourn: 58, nl: 72, fr: 76,
    note: "Host — no qualifiers. NL 24-25 3rd (beat USA). Gold Cup 2025 QF exit on pens to Guatemala. Solid peer friendlies under Marsch." },
};

// ---------------------------------------------------------------------------
// TACTICAL AXIS — pace vs defensive-line height (0-10 each). This is the
// ORTHOGONAL factor the style buckets couldn't express: a team's threat IN
// BEHIND (pace) and how high it defends (line). A pacy front punishes a high
// line (space to run into); the same pace is half-wasted on a deep block
// (nowhere to run). Feeds a small xG multiplier in predict.js, independent of
// the style rock-paper-scissors — so it can break ties the quality signals
// (strength/momentum/form) can't. Values are grounded team characteristics,
// illustrative. Teams not listed default to neutral 5/5.
//   pace = attacking threat in behind (Vinícius/Mbappé high, control sides low)
//   line = defensive line height (possession sides high, park-the-bus low)
// ---------------------------------------------------------------------------
// pace = attacking threat in behind (fastest 2-3 ATTACKERS actually starting);
// line = defensive line height; defSpeed = recovery pace of the actual back
// line, weighted to the FULLBACKS. Player identities verified against real
// 2026 squad/XI data (July 6) — same rule as PLAYMAKERS: only players who
// actually start this WC. Values are calibrated from those confirmed starters'
// known pace; FIFA sprint-speed validation is a further refinement.
// ── QUARTERFINALISTS: verified July 9 against actual R16 starting XIs (not
//    predicted lineups). Each comment cites the real back line + attack. ──
const TACTICAL = {
  "France":      { pace: 10, line: 6, defSpeed: 7 }, // XI: Koundé/Saliba/Upamecano (all quick) + Digne LB (aging, the one soft spot — NOT Théo). Mbappé pace up top
  "Spain":       { pace: 6,  line: 8, defSpeed: 4 }, // Nico Williams OUT (adductor, done for the tournament) → pace-in-behind gone; Yamal a dribbler not a burner. XI back line Porro/Laporte/Cubarsí/Cucurella — no Carvajal, not quick → VERY high line exploitable BY opponents
  "England":     { pace: 8,  line: 5, defSpeed: 6 }, // Quansah SUSPENDED (2-match ban, red card vs Mexico) for the Norway QF — his pace was part of the "genuinely quick" back line; expected replacement (Konsa shifting to RB / Stones or Burn at CB) is more experienced than rapid, so defSpeed nudged down from 7. Attack Saka + Gordon both rapid → higher pace still holds
  "Argentina":   { pace: 6,  line: 6, defSpeed: 5 }, // CORRECTED: Otamendi BENCHED — actual CBs are Romero + Lisandro Martínez (both athletic); Molina/Tagliafico FBs. Not the slow line I'd assumed. Messi/Álvarez control over pace up top
  "Belgium":     { pace: 8,  line: 5, defSpeed: 5 }, // rated on FIRST-CHOICE XI (Doku/DBK/Lukaku were rested vs USA): Doku's burst; Castagne/De Cuyper/Theate moderate; mid-block counter
  "Norway":      { pace: 7,  line: 7, defSpeed: 4 }, // confirmed XI: Ajer/Heggem CBs + Pedersen/Møller Wolfe FBs — a high-ish line WITHOUT recovery pace (why France ran them 4-1). Nusa quick, Haaland power
  "Morocco":     { pace: 6,  line: 3, defSpeed: 6 }, // XI: Hakimi + Mazraoui (quick FBs), Diop/Halhal CBs; front is CREATIVE (Brahim/Ounahi/El Khannouss) not out-and-out pacy — off a deep low block
  "Switzerland": { pace: 6,  line: 5, defSpeed: 5 }, // confirmed XI: Akanji (fast CB) + Elvedi, Zakaria at RB, Rodríguez LB (aging); Ndoye quick up top; organized mid line
  // ── eliminated (kept for reference; no longer predicted) ──
  "Portugal":    { pace: 8,  line: 5, defSpeed: 7 }, // out (lost 0-1 Spain)
  "Colombia":    { pace: 8,  line: 6, defSpeed: 5 }, // out (pens vs Switzerland)
  "USA":         { pace: 7,  line: 6, defSpeed: 5 }, // out (4-1 Belgium)
  "Mexico":      { pace: 6,  line: 6, defSpeed: 5 }, // out (2-3 England)
  "Egypt":       { pace: 7,  line: 3, defSpeed: 4 }, // out (2-3 Argentina)
  "Brazil":      { pace: 9,  line: 6, defSpeed: 5 }, // out (1-2 Norway)
};

// How much an opponent's defensive approach blunts or enables creative
// players (multiplier on the creativity bonus, tuned to the "Olise effect":
// aggressive/physical teams engage and foul early, cutting off time on the
// ball; teams that sit off or don't press hard hand playmakers time and space).
const CREATIVITY_SUPPRESSION = {
  PRESS:      0.55,
  DIRECT:     0.65,
  TOTAL:      0.75,
  COUNTER:    0.95,
  BALANCED:   1.00,
  POSSESSION: 1.10,
  PARK_BUS:   1.25,
};

// Round of 32 results (completed matches). aet = after extra time.
const RESULTS = [
  { round: "Round of 32", date: "Jun 28", a: "Canada", b: "South Africa", scoreA: 1, scoreB: 0, note: "" },
  { round: "Round of 32", date: "Jun 29", a: "Brazil", b: "Japan", scoreA: 2, scoreB: 1, note: "", goalsA: [56, 90], goalsB: [29] },
  { round: "Round of 32", date: "Jun 29", a: "Paraguay", b: "Germany", scoreA: 1, scoreB: 1, note: "aet — Paraguay won 4-3 on penalties" },
  { round: "Round of 32", date: "Jun 29", a: "Morocco", b: "Netherlands", scoreA: 1, scoreB: 1, note: "aet — Morocco won 3-2 on penalties", goalsA: [90], goalsB: [72] },
  { round: "Round of 32", date: "Jun 30", a: "Norway", b: "Ivory Coast", scoreA: 2, scoreB: 1, note: "" },
  { round: "Round of 32", date: "Jun 30", a: "France", b: "Sweden", scoreA: 3, scoreB: 0, note: "" },
  { round: "Round of 32", date: "Jun 30", a: "Mexico", b: "Ecuador", scoreA: 2, scoreB: 0, note: "" },
  { round: "Round of 32", date: "Jul 1",  a: "England", b: "DR Congo", scoreA: 2, scoreB: 1, note: "" },
  { round: "Round of 32", date: "Jul 1",  a: "Belgium", b: "Senegal", scoreA: 3, scoreB: 2, note: "aet" },
  { round: "Round of 32", date: "Jul 1",  a: "USA", b: "Bosnia and Herzegovina", scoreA: 2, scoreB: 0, note: "" },
  { round: "Round of 32", date: "Jul 2",  a: "Spain", b: "Austria", scoreA: 3, scoreB: 0, note: "" },
  { round: "Round of 32", date: "Jul 2",  a: "Portugal", b: "Croatia", scoreA: 2, scoreB: 1, note: "" },
  { round: "Round of 32", date: "Jul 2",  a: "Switzerland", b: "Algeria", scoreA: 2, scoreB: 0, note: "" },
  { round: "Round of 32", date: "Jul 3",  a: "Egypt", b: "Australia", scoreA: 1, scoreB: 1, note: "aet — Egypt won 4-2 on penalties" },
  { round: "Round of 32", date: "Jul 3", a: "Argentina", b: "Cape Verde", scoreA: 3, scoreB: 2, note: "aet — Cape Verde took the defending champions to the wire" },
  // goalsA/goalsB (optional) = minute of each goal, for team-specific goal-timing.
  // Normalize stoppage/ET to the base minute (45+2 -> 45, 90+3 -> 90). The daily
  // updater fills these in as it records games; older games get backfilled when
  // web access is available. Colombia-Ghana seeded (Arias 14').
  { round: "Round of 32", date: "Jul 3", a: "Colombia", b: "Ghana", scoreA: 1, scoreB: 0, note: "", goalsA: [14], goalsB: [] },
  { round: "Round of 16", date: "Jul 4", a: "Canada", b: "Morocco", scoreA: 0, scoreB: 3, note: "" },
  { round: "Round of 16", date: "Jul 4", a: "Paraguay", b: "France", scoreA: 0, scoreB: 1, note: "" },
  { round: "Round of 16", date: "Jul 5", a: "Brazil", b: "Norway", scoreA: 1, scoreB: 2, note: "", goalsA: [90], goalsB: [79, 90] },
  { round: "Round of 16", date: "Jul 5", a: "Mexico", b: "England", scoreA: 2, scoreB: 3, note: "", goalsA: [42, 69], goalsB: [36, 38, 60] },
  { round: "Round of 16", date: "Jul 6", a: "Portugal", b: "Spain", scoreA: 0, scoreB: 1, note: "", goalsA: [], goalsB: [90] },
  { round: "Round of 16", date: "Jul 6", a: "USA", b: "Belgium", scoreA: 1, scoreB: 4, note: "", goalsA: [31], goalsB: [9, 33, 57, 90] },
  { round: "Round of 16", date: "Jul 7", a: "Argentina", b: "Egypt", scoreA: 3, scoreB: 2, note: "", goalsA: [79, 83, 90], goalsB: [15, 67] },
  { round: "Round of 16", date: "Jul 7", a: "Switzerland", b: "Colombia", scoreA: 0, scoreB: 0, note: "aet — Switzerland won 4-3 on penalties", goalsA: [], goalsB: [] },
];

// Upcoming fixtures — everything still to be played. The Predictions tab
// covers all of these. venueCountry powers the home-advantage bump for the
// three host nations.
const FIXTURES = [
  { round: "Quarterfinal", date: "Jul 9", venue: "Boston",      venueCountry: "US", a: "Morocco",     b: "France",
    marketScores: [{ a: 0, b: 1, pct: 16 }, { a: 0, b: 2 }], // bookmakers: France 1-0 shortest odds (16%), then France 2-0
    insight: "Both sides are missing a piece of their midfield engine. Morocco winger Ismael Saibari (hamstring, picked up in the round of 16 win over Canada) is confirmed out, thinning an already conservative attack further. France's Aurélien Tchouaméni (adductor) is a major doubt too — he returned to training July 8 but Deschamps hasn't confirmed a start, so Manu Koné may deputise, leaving less defensive cover in front of a back line already without Théo Hernandez-level pace at left-back." },
  { round: "Quarterfinal", date: "Jul 10", venue: "Los Angeles", venueCountry: "US", a: "Spain",       b: "Belgium",
    marketScores: [{ a: 1, b: 0 }, { a: 2, b: 0 }], // bookmakers: Spain 1-0 shortest, then Spain 2-0 (Spain hasn't conceded all tournament)
    insight: "Belgium loses a starter for the rest of the tournament: Amadou Onana tore his ACL during the round of 16 win over the USA and is out. He wasn't a top-3 creative player, but he was the midfield's defensive screen — without him, Spain's front three (Yamal/Pedri/Olmo) should find even more room to combine centrally against an already-stretched Belgian block." },
  { round: "Quarterfinal", date: "Jul 11", venue: "Miami Gardens", venueCountry: "US", a: "Norway",   b: "England",
    insight: "England will be without Jarell Quansah for this one — FIFA handed him a two-match ban (covering the semifinal too, if England get there) for his red card against Mexico. He was part of a back line specifically noted as young and genuinely quick; the expected reshuffle (Konsa into a back-line role, Stones or Burn partnering Guéhi) trades some of that recovery pace for size and experience, which matters against a Norway side built to spring Haaland in behind." },
  { round: "Quarterfinal", date: "Jul 11", venue: "Kansas City", venueCountry: "US", a: "Argentina",   b: "Switzerland" },
];

// ---------------------------------------------------------------------------
// Group stage records (compiled from ESPN/FOX standings, July 2026).
// w/d/l, goals for/against, and the three group opponents — rated opponents by
// name, unrated (eliminated non-R32) opponents as a default strength of 70.
// Used to compute schedule-adjusted form and empirical attack/defence factors.
// ---------------------------------------------------------------------------
const GROUP_STAGE = {
  "Mexico":                 { w: 3, d: 0, l: 0, gf: 6,  ga: 0, opps: ["South Africa", 70, 70] },
  "South Africa":           { w: 1, d: 1, l: 1, gf: 2,  ga: 3, opps: ["Mexico", 70, 70] },
  "Switzerland":            { w: 2, d: 1, l: 0, gf: 7,  ga: 3, opps: ["Canada", "Bosnia and Herzegovina", 70] },
  "Canada":                 { w: 1, d: 1, l: 1, gf: 8,  ga: 3, opps: ["Switzerland", "Bosnia and Herzegovina", 70] },
  "Bosnia and Herzegovina": { w: 1, d: 1, l: 1, gf: 5,  ga: 6, opps: ["Switzerland", "Canada", 70] },
  "Brazil":                 { w: 2, d: 1, l: 0, gf: 7,  ga: 1, opps: ["Morocco", 70, 70] },
  "Morocco":                { w: 2, d: 1, l: 0, gf: 6,  ga: 3, opps: ["Brazil", 70, 70] },
  "USA":                    { w: 2, d: 0, l: 1, gf: 8,  ga: 4, opps: ["Australia", "Paraguay", 70] },
  "Australia":              { w: 1, d: 1, l: 1, gf: 2,  ga: 2, opps: ["USA", "Paraguay", 70] },
  "Paraguay":               { w: 1, d: 1, l: 1, gf: 2,  ga: 4, opps: ["USA", "Australia", 70] },
  "Germany":                { w: 2, d: 0, l: 1, gf: 10, ga: 4, opps: ["Ivory Coast", "Ecuador", 70] },
  "Ivory Coast":            { w: 2, d: 0, l: 1, gf: 4,  ga: 2, opps: ["Germany", "Ecuador", 70] },
  "Ecuador":                { w: 1, d: 1, l: 1, gf: 2,  ga: 2, opps: ["Germany", "Ivory Coast", 70] },
  "Netherlands":            { w: 2, d: 1, l: 0, gf: 10, ga: 4, opps: ["Japan", "Sweden", 70] },
  "Japan":                  { w: 1, d: 2, l: 0, gf: 7,  ga: 3, opps: ["Netherlands", "Sweden", 70] },
  "Sweden":                 { w: 1, d: 1, l: 1, gf: 7,  ga: 7, opps: ["Netherlands", "Japan", 70] },
  "Belgium":                { w: 1, d: 2, l: 0, gf: 6,  ga: 2, opps: ["Egypt", 70, 70] },
  "Egypt":                  { w: 1, d: 2, l: 0, gf: 5,  ga: 3, opps: ["Belgium", 70, 70] },
  "Spain":                  { w: 2, d: 1, l: 0, gf: 5,  ga: 0, opps: ["Cape Verde", "Uruguay", 70] },
  "Cape Verde":             { w: 0, d: 3, l: 0, gf: 2,  ga: 2, opps: ["Spain", "Uruguay", 70] },
  "Uruguay":                { w: 0, d: 2, l: 1, gf: 3,  ga: 4, opps: ["Spain", "Cape Verde", 70] },
  "France":                 { w: 3, d: 0, l: 0, gf: 10, ga: 2, opps: ["Norway", "Senegal", 70] },
  "Norway":                 { w: 2, d: 0, l: 1, gf: 8,  ga: 7, opps: ["France", "Senegal", 70] },
  "Senegal":                { w: 1, d: 0, l: 2, gf: 8,  ga: 6, opps: ["France", "Norway", 70] },
  "Argentina":              { w: 3, d: 0, l: 0, gf: 8,  ga: 1, opps: ["Austria", "Algeria", 70] },
  "Austria":                { w: 1, d: 1, l: 1, gf: 6,  ga: 6, opps: ["Argentina", "Algeria", 70] },
  "Algeria":                { w: 1, d: 1, l: 1, gf: 5,  ga: 7, opps: ["Argentina", "Austria", 70] },
  "Colombia":               { w: 2, d: 1, l: 0, gf: 4,  ga: 1, opps: ["Portugal", "DR Congo", 70] },
  "Portugal":               { w: 1, d: 2, l: 0, gf: 6,  ga: 1, opps: ["Colombia", "DR Congo", 70] },
  "DR Congo":               { w: 1, d: 1, l: 1, gf: 4,  ga: 3, opps: ["Colombia", "Portugal", 70] },
  "England":                { w: 2, d: 1, l: 0, gf: 6,  ga: 2, opps: ["Croatia", "Ghana", 70] },
  "Croatia":                { w: 2, d: 0, l: 1, gf: 5,  ga: 5, opps: ["England", "Ghana", 70] },
  "Ghana":                  { w: 1, d: 1, l: 1, gf: 2,  ga: 2, opps: ["England", "Croatia", 70] },
};

// Real GROUP-STAGE goal minutes (from Wikipedia group pages, July 2026),
// normalized (45+X→45, 90+X→90). scoredByGame = this team's goals grouped by
// match (kept per-game so the "scores in bursts" detector can tell two goals
// in one game from two goals across games); concededMins = goals it let in
// (flat — concede-timing only needs the distribution). Cross-checked against
// each team's gf/ga above. A few conceded minutes weren't listed in the source
// (Morocco vs Haiti, Egypt–Iran 1-1) and are omitted — the model shrinks
// toward the style prior rather than inventing them. Knockout-round minutes
// live on RESULTS entries (goalsA/goalsB); teamRealTiming merges both sources.
const GROUP_GOAL_MINS = {
  "Brazil":      { scoredByGame: [[32], [23, 36, 45], [7, 45, 60]], concededMins: [21] },
  "Morocco":     { scoredByGame: [[21], [2], [39, 45, 78, 89]], concededMins: [32] },
  "France":      { scoredByGame: [[66, 82, 90], [14, 54, 66], [7, 20, 32, 90]], concededMins: [21, 90] },
  "Norway":      { scoredByGame: [[29, 43, 76, 90], [43, 48, 58], [21]], concededMins: [7, 20, 32, 39, 53, 90, 90] },
  "Mexico":      { scoredByGame: [[9, 67], [50], [55, 61, 90]], concededMins: [] },
  "England":     { scoredByGame: [[12, 42, 47, 85], [], [62, 67]], concededMins: [36, 45] },
  "Spain":       { scoredByGame: [[], [10, 21, 24, 49], [42]], concededMins: [] },
  "Portugal":    { scoredByGame: [[6], [6, 17, 39, 60, 87], []], concededMins: [45] },
  "Colombia":    { scoredByGame: [[40, 65, 90], [76], []], concededMins: [60] },
  "Belgium":     { scoredByGame: [[66], [], [28, 50, 66, 86, 90]], concededMins: [19, 84] },
  "Egypt":       { scoredByGame: [[19], [58, 67, 82], []], concededMins: [15, 66] },
  "USA":         { scoredByGame: [[7, 31, 45, 90], [11, 43], [3, 49]], concededMins: [10, 31, 73, 90] },
  "Argentina":   { scoredByGame: [[17, 60, 76], [38, 90], [19, 31, 80]], concededMins: [55] },
  "Switzerland": { scoredByGame: [[17], [74, 84, 90, 90], [46, 57]], concededMins: [76, 90, 90] },
};
