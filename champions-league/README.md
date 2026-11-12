# ⭐ Champions League 2026/27 Predictor

The World Cup 2026 dashboard's model, rebuilt for clubs and the 36-team league phase.

**Snapshot date:** November 12, 2026, after Matchday 4. Data from ESPN (tables, results, last-10 home/away games).

## Features

- **League Table** — current standings plus the chance of each team finishing top 8, 9-24 or 25-36, from 10,000 simulations of the remaining fixtures.
- **Matches & Predictions** — results for played matchdays, and a prediction card for every upcoming match: win/draw/win odds, headline score, top scorelines, over 2.5, both teams to score, and the reasons behind the pick.
- **Team Ratings** — every team's rating breakdown, home/away record and remaining schedule difficulty.
- **How It Works** — the full method and the data caveats.

## The rating

`rating = 40% squad + 30% momentum + 30% form`

| Layer | What it measures |
| --- | --- |
| Squad | Player level, from squad market value (log scale) |
| Momentum | Last two domestic seasons (70% 2025-26 / 30% 2024-25) × league strength, plus last season's Champions League run |
| Form | This season: domestic results since mid-August × league strength, and Champions League results vs expectation |

Predictions add home advantage (scaled by each team's own home/away record), the playstyle matchup table from the World Cup model, and a goals-environment factor.

## Running it

No build step. Open `index.html` in a browser.

## Updating

Edit [`data.js`](data.js):

- `MATCHES` — fill in `hs` / `as` for completed games.
- `TEAMS[name].dom` — domestic record (games, W-D-L, goals, position, home/away split).

Ratings, predictions and odds all recompute from these inputs.
