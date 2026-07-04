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

function renderTeamsGrid(filter) {
  const grid = document.getElementById("teams-grid");
  const entries = Object.entries(TEAMS)
    .filter(([, t]) => filter === "ALL" || !filter || t.style === filter)
    .sort((a, b) => b[1].strength - a[1].strength);

  grid.innerHTML = entries.map(([name, t]) => {
    const style = STYLES[t.style];
    return `
      <div class="team-card">
        <div class="team-card-header">
          ${flagImg(name, "lg")}
          <span class="team-name">${name}</span>
        </div>
        <span class="style-badge" style="background:${style.color}">${style.label}</span>
        <p class="team-blurb">${t.blurb}</p>
        <div class="strength-bar-track">
          <div class="strength-bar-fill" style="width:${t.strength}%"></div>
        </div>
        <span class="strength-label">Strength: ${t.strength} · Tournament form: ${t.form}</span>
        <p class="form-note">${t.formNote}</p>
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
    const p = predictMatch(f.a, f.b);
    if (!p) return "";
    const pctA = Math.round(p.winProbA * 100);
    const pctB = 100 - pctA;

    const statsHtml = STAT_META.map(meta => statRow(meta, p.statsA[meta.key], p.statsB[meta.key])).join("");

    const oddsHtml = p.topScores.map(s => `
      <div class="odds-chip">
        <span class="odds-score">${s.a}-${s.b}</span>
        <span class="odds-pct">${(s.prob * 100).toFixed(1)}%</span>
      </div>`).join("");

    return `
      <div class="prediction-card" data-idx="${idx}">
        <div class="prediction-header">
          <span>${f.round} · ${f.date} · ${f.venue}${f.note ? " — " + f.note : ""}</span>
        </div>
        <div class="prediction-matchup">
          <div class="pred-team">
            ${flagImg(f.a, "lg")}
            <span class="team-name">${f.a}</span>
            <span class="style-badge small" style="background:${STYLES[p.teamA.style].color}">${STYLES[p.teamA.style].label}</span>
          </div>
          <div class="pred-score">${p.scoreA} – ${p.scoreB}</div>
          <div class="pred-team">
            ${flagImg(f.b, "lg")}
            <span class="team-name">${f.b}</span>
            <span class="style-badge small" style="background:${STYLES[p.teamB.style].color}">${STYLES[p.teamB.style].label}</span>
          </div>
        </div>
        <div class="prob-bar">
          <div class="prob-fill-a" style="width:${pctA}%">${pctA}%</div>
          <div class="prob-fill-b" style="width:${pctB}%">${pctB}%</div>
        </div>
        ${p.penaltiesLikely ? '<p class="penalty-note">Tight, defensive matchup — could well go to extra time and penalties.</p>' : ""}
        <p class="reasoning">${p.reasoning}</p>

        <button class="toggle-details-btn" data-toggle="${idx}">Match Stats &amp; Correct Score Odds ▾</button>

        <div class="prediction-details" id="details-${idx}">
          <h4>Tournament Form</h4>
          <div class="form-compare">
            <p><strong>${f.a}</strong> (form ${p.teamA.form}): ${p.teamA.formNote}</p>
            <p><strong>${f.b}</strong> (form ${p.teamB.form}): ${p.teamB.formNote}</p>
          </div>
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
      btn.textContent = open ? "Match Stats & Correct Score Odds ▲" : "Match Stats & Correct Score Odds ▾";
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
