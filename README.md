# ⚽ World Cup 2026 Predictor

A single-page dashboard for the 2026 FIFA World Cup knockout stage: live-ish scores, team playstyle profiles, and fun heuristic match predictions.

**Snapshot date:** July 4, 2026 — Round of 16 kickoff.

## Features

- **Scores & Bracket** — Round of 32 results and upcoming fixtures.
- **Team Playstyles** — every remaining team classified by playstyle (possession, high press, counter-attack, park the bus, …) with strength and tournament-form ratings, filterable by style.
- **Predictions** — win probabilities, most likely scorelines, and head-to-head stat comparisons for every upcoming match.

## How predictions work

The model is a lightweight heuristic, clearly labelled in the UI as "for fun" — not a real forecasting service. It blends:

1. **Team strength** (long-term squad quality) and **tournament form** (65% / 35%)
2. A rock-paper-scissors style **playstyle matchup bonus** (e.g. counter-attack thrives against possession)
3. A **Poisson goal model** to rank the most likely correct scores

All logic lives in [`predict.js`](predict.js).

## Running it

No build step, no dependencies — just open `index.html` in a browser:

```
start index.html   # Windows
open index.html    # macOS
```

Flag images are loaded from [flagcdn.com](https://flagcdn.com), so an internet connection is needed for flags to display.

## Updating the data

Scores are a **manual snapshot**, not a live feed. To keep the dashboard current, edit [`data.js`](data.js):

- `RESULTS` — completed matches (set `scoreA` / `scoreB`, add a `note` for extra time or penalties)
- `FIXTURES` — upcoming matches (the Predictions tab covers all of these)
- `TEAMS` — per-team `strength`, `form`, `formNote`, and `style`

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Page skeleton and tab layout |
| `data.js` | Teams, playstyles, results, and fixtures (edit this to refresh) |
| `predict.js` | Prediction engine: ratings, matchup bonuses, Poisson scorelines |
| `app.js` | Rendering and UI wiring |
| `style.css` | Dark-theme styling |
