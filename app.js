// ---------------------------------------------------------------------------
// Rendering / UI wiring
// ---------------------------------------------------------------------------

// Real flag images (emoji flags render as letter codes on Windows)
function flagImg(name, size) {
  const t = TEAMS[name];
  if (!t) return "";
  const dims = size === "lg" ? "40x30" : "24x18";
  const dims2x = size === "lg" ? "80x60" : "48x36";
  return `<img class="flag-img ${size === "lg" ? "lg" : ""}" src="https://flagcdn.com/${dims}/${t.code}.png" srcset="https://flagcdn.com/${dims2x}/${t.code}.png 2x" alt="${name} flag">`;
}

function teamLabel(name) {
  return TEAMS[name] ? `${flagImg(name)} ${name}` : name;
}

function renderResults() {
  const rows = RESULTS.map(r => {
    const pending = r.scoreA === null;
    const scoreText = pending ? "vs" : `${r.scoreA} – ${r.scoreB}`;
    return `
      <div class="match-row ${pending ? "pending" : ""}">
        <span class="match-date">${r.date}</span>
        <span class="match-team home">${teamLabel(r.a)}</span>
        <span class="match-score">${scoreText}</span>
        <span class="match-team away">${teamLabel(r.b)}</span>
        <span class="match-note">${r.note}</span>
      </div>`;
  }).join("");
  document.getElementById("results-table").innerHTML = rows;
}

function renderFixtures() {
  const rows = FIXTURES.map(f => `
      <div class="match-row fixture">
        <span class="match-date">${f.date}</span>
        <span class="match-team home">${teamLabel(f.a)}</span>
        <span class="match-score">vs</span>
        <span class="match-team away">${teamLabel(f.b)}</span>
        <span class="match-note">${f.round} · ${f.venue}${f.note ? " — " + f.note : ""}</span>
      </div>`).join("");
  document.getElementById("fixtures-table").innerHTML = rows;
}

function renderStyleFilters() {
  const container = document.getElementById("style-filters");
  const allBtn = `<button class="filter-btn active" data-style="ALL">All</button>`;
  const btns = Object.entries(STYLES).map(([key, s]) =>
    `<button class="filter-btn" data-style="${key}" style="--accent:${s.color}">${s.label}</button>`
  ).join("");
  container.innerHTML = allBtn + btns;

  container.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderTeamsGrid(btn.dataset.style);
    });
  });
}

// Ordering experiment: group each upcoming fixture's two teams next to each
// other (in fixture order) instead of sorting purely by strength/rating.
// Teams not in any current fixture (i.e. eliminated ones) fall through to
// the strength-sort fallback, then get pushed to the end by the eliminated
// check above them.
const FIXTURE_ORDER = {};
FIXTURES.forEach((f, i) => {
  if (FIXTURE_ORDER[f.a] === undefined) FIXTURE_ORDER[f.a] = i * 2;
  if (FIXTURE_ORDER[f.b] === undefined) FIXTURE_ORDER[f.b] = i * 2 + 1;
});

function renderTeamsGrid(filter) {
  const grid = document.getElementById("teams-grid");
  const entries = Object.entries(TEAMS)
    .filter(([, t]) => filter === "ALL" || !filter || t.style === filter)
    .sort((a, b) => {
      if (!!a[1].eliminated !== !!b[1].eliminated) return (!!a[1].eliminated) - (!!b[1].eliminated);
      const ra = FIXTURE_ORDER[a[0]], rb = FIXTURE_ORDER[b[0]];
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return b[1].strength - a[1].strength;
    });

  grid.innerHTML = entries.map(([name, t]) => {
    const style = STYLES[t.style];
    return `
      <div class="team-card ${t.eliminated ? "eliminated" : ""}">
        ${t.eliminated ? '<span class="out-badge">OUT</span>' : ""}
        <div class="team-card-header">
          ${flagImg(name, "lg")}
          <span class="team-name">${name}</span>
        </div>
        <span class="style-badge" style="background:${style.color}">${style.label}</span>
        <p class="team-blurb">${t.blurb}</p>
        <div class="strength-bar-track">
          <div class="strength-bar-fill" style="width:${t.strength}%"></div>
        </div>
        <span class="strength-label" ${typeof MOMENTUM_PEDIGREE !== "undefined" && MOMENTUM_PEDIGREE[name] ? `title="${MOMENTUM_PEDIGREE[name].note.replace(/"/g, "&quot;")}"` : ""}>Strength: ${t.strength} · Momentum (current era): ${t.momentum != null ? t.momentum : t.strength} · Tournament form: ${t.form}</span>
        <p class="form-note">${t.eliminatedNote || t.formNote}</p>
      </div>`;
  }).join("");
}

function statRow(meta, valueA, valueB) {
  const a = formatStat(valueA, meta.key);
  const b = formatStat(valueB, meta.key);
  const aWins = meta.higherBetter ? valueA >= valueB : valueA <= valueB;
  // Bar widths relative to the max of the two so the leader always fills more
  const maxV = Math.max(valueA, valueB) || 1;
  const widthA = Math.max(8, (valueA / maxV) * 100);
  const widthB = Math.max(8, (valueB / maxV) * 100);
  return `
    <div class="stat-row">
      <span class="stat-value ${aWins ? "stat-lead" : ""}">${a}${meta.unit}</span>
      <div class="stat-bars">
        <div class="stat-bar-label">${meta.label}</div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill left ${aWins ? "lead" : ""}" style="width:${widthA}%"></div>
          <div class="stat-bar-fill right ${!aWins ? "lead" : ""}" style="width:${widthB}%"></div>
        </div>
      </div>
      <span class="stat-value ${!aWins ? "stat-lead" : ""}">${b}${meta.unit}</span>
    </div>`;
}

function renderPredictions() {
  const container = document.getElementById("predictions-list");
  container.innerHTML = FIXTURES.map((f, idx) => {
    const p = predictMatch(f.a, f.b, { venueCountry: f.venueCountry });
    if (!p) return "";
    const pctA = Math.round(p.winProbA * 100);
    const pctD = Math.round(p.drawProb * 100);
    const pctB = 100 - pctA - pctD;

    const statsHtml = STAT_META.map(meta => statRow(meta, p.statsA[meta.key], p.statsB[meta.key])).join("");

    const oddsHtml = p.topScores.map(s => `
      <div class="odds-chip">
        <span class="odds-score">${s.a}-${s.b}</span>
        <span class="odds-pct">${(s.prob * 100).toFixed(1)}%</span>
      </div>`).join("");

    const scenarioHtml = p.scenarios.map(s => `
      <div class="scenario">
        <div class="scenario-title">${s.title}</div>
        <div class="scenario-bythen">${s.byThen}</div>
        <div class="scenario-proj"><span class="scenario-nums">${s.line}</span><span class="scenario-final">likely ≈ ${s.projected}</span></div>
        <div class="scenario-note">${s.note}</div>
      </div>`).join("");

    // Statistically most common scoreline — shown small next to our headline
    // pick. If the calibrated distribution's modal score IS our pick, show
    // the runner-up instead so the line always adds information.
    const modal = p.topScores[0];
    const alt = (modal.a === p.scoreA && modal.b === p.scoreB) ? p.topScores[1] : modal;
    const altLabel = (modal.a === p.scoreA && modal.b === p.scoreB) ? "next most common" : "most common";

    return `
      <div class="prediction-card" data-idx="${idx}">
        <div class="prediction-header">
          <span>${f.round} · ${f.date} · ${f.venue}${f.note ? " — " + f.note : ""}</span>
          <span class="conf-chip conf-${p.confidence.level.toLowerCase()}" title="${p.confidence.why}">${p.confidence.level} confidence</span>
        </div>
        <div class="prediction-matchup">
          <div class="pred-team">
            ${flagImg(f.a, "lg")}
            <span class="team-name">${f.a}</span>
            <span class="style-badge small" style="background:${STYLES[p.teamA.style].color}">${STYLES[p.teamA.style].label}</span>
          </div>
          <div class="pred-score">${p.scoreA} – ${p.scoreB}<span class="pred-xg">xG ${p.xgA.toFixed(1)} – ${p.xgB.toFixed(1)}</span><span class="pred-common">${altLabel}: ${alt.a}–${alt.b} (${(alt.prob * 100).toFixed(0)}%)</span></div>
          <div class="pred-team">
            ${flagImg(f.b, "lg")}
            <span class="team-name">${f.b}</span>
            <span class="style-badge small" style="background:${STYLES[p.teamB.style].color}">${STYLES[p.teamB.style].label}</span>
          </div>
        </div>
        <div class="prob-legend"><span>${f.a} win</span><span>Draw</span><span>${f.b} win</span></div>
        <div class="prob-bar">
          <div class="prob-fill-a" style="width:${pctA}%">${pctA}%</div>
          <div class="prob-fill-d" style="width:${pctD}%">${pctD}%</div>
          <div class="prob-fill-b" style="width:${pctB}%">${pctB}%</div>
        </div>
        ${p.confidence.level !== "High" ? `<p class="confidence-why conf-why-${p.confidence.level.toLowerCase()}"><strong>${p.confidence.level} confidence:</strong> ${p.confidence.why}</p>` : ""}
        ${p.penaltiesLikely ? '<p class="penalty-note">High draw probability — a real chance of extra time and penalties.</p>' : ""}
        <p class="reasoning">${p.reasoning}</p>
        ${f.insight ? `<div class="matchup-insight"><span class="insight-label">⚡ Matchup deep-dive</span><p>${f.insight}</p></div>` : ""}

        <button class="toggle-details-btn" data-toggle="${idx}">Stats, Scenarios &amp; Correct Score Odds ▾</button>

        <div class="prediction-details" id="details-${idx}">
          <h4>Game-State Scenarios <span class="h4-sub">how the game shifts once someone leads</span></h4>
          <p class="timing-profile">Goal timing: <strong>${f.a}</strong> scores most in ${p.timingA.label} (${p.timingA.pct}%), concedes most in ${p.concedeA.label} (${p.concedeA.pct}%) · <strong>${f.b}</strong> scores in ${p.timingB.label} (${p.timingB.pct}%), concedes in ${p.concedeB.label} (${p.concedeB.pct}%)
          ${(p.timingSampleA + p.timingSampleB) === 0 ? '<span class="timing-src">— style estimates; real goal-minute data fills in as games are recorded</span>' : `<span class="timing-src">— based on ${p.timingSampleA + p.timingSampleB} recorded goal-minutes + style priors</span>`}</p>
          ${[[f.a, p.clusterA], [f.b, p.clusterB]].filter(([, c]) => c && c.bursty).map(([name, c]) => `<p class="burst-note">⚡ <strong>${name}</strong> scores in bursts — ${c.clustered} of ${c.eligible} follow-up goals came within 10' of a previous one. Once they score, expect another soon.</p>`).join("")}
          <div class="scenario-list">${scenarioHtml}</div>
          <h4>Tournament Form <span class="h4-sub">strength · momentum (current era) · this tournament</span></h4>
          <div class="form-compare">
            <p><strong>${f.a}</strong> (${p.teamA.strength} · ${p.teamA.momentum != null ? p.teamA.momentum : p.teamA.strength} · ${p.teamA.form}): ${p.teamA.formNote}</p>
            <p><strong>${f.b}</strong> (${p.teamB.strength} · ${p.teamB.momentum != null ? p.teamB.momentum : p.teamB.strength} · ${p.teamB.form}): ${p.teamB.formNote}</p>
          </div>
          ${(p.creativityA != null || p.creativityB != null) ? `
          <h4>Creativity Battle <span class="h4-sub">top-3 playmakers, adjusted for this opponent's style</span></h4>
          <div class="form-compare creativity-compare">
            ${p.creativityA != null ? `<p><strong>${f.a}</strong> (avg ${p.creativityA.toFixed(1)}): ${PLAYMAKERS[f.a].map(pl => pl.name).join(", ")}</p>` : ""}
            ${p.creativityB != null ? `<p><strong>${f.b}</strong> (avg ${p.creativityB.toFixed(1)}): ${PLAYMAKERS[f.b].map(pl => pl.name).join(", ")}</p>` : ""}
            ${p.creativityNote ? `<p class="creativity-note">${p.creativityNote}</p>` : ""}
          </div>` : ""}
          <h4>Head-to-Head Stats</h4>
          <div class="stat-table">${statsHtml}</div>
          <h4>Most Likely Correct Scores</h4>
          <div class="odds-row">${oddsHtml}</div>
        </div>
      </div>`;
  }).join("");

  container.querySelectorAll(".toggle-details-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.toggle;
      const details = document.getElementById(`details-${idx}`);
      const open = details.classList.toggle("open");
      btn.classList.toggle("open", open);
      btn.textContent = open ? "Stats, Scenarios & Correct Score Odds ▲" : "Stats, Scenarios & Correct Score Odds ▾";
    });
  });
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

setupTabs();
renderResults();
renderFixtures();
renderStyleFilters();
renderTeamsGrid("ALL");
renderPredictions();
