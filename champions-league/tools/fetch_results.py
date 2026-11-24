#!/usr/bin/env python3
"""Fill in finished Champions League scores in data.js from 365Scores.

Only league-phase fixtures that are still unplayed in data.js (no hs/as) and
have ended on 365Scores are touched; the score is added after the teams, and
any stored picks (pred / predNews) stay as they were, so the scorecard grades
them.

    python3 champions-league/tools/fetch_results.py
"""
import json
import pathlib
import re
import sys
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_odds import TEAM_IDS  # noqa: E402  (365Scores id -> data.js name)

DATA = pathlib.Path(__file__).resolve().parent.parent / "data.js"
URL = ("https://webws.365scores.com/web/games/results/"
       "?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6&competitions=572")
ENDED = 4


def main():
    with urllib.request.urlopen(URL, timeout=30) as resp:
        games = json.load(resp).get("games", [])
    src = DATA.read_text()
    added = []
    for g in games:
        if g.get("statusGroup") != ENDED:
            continue
        home = TEAM_IDS.get(g["homeCompetitor"]["id"])
        away = TEAM_IDS.get(g["awayCompetitor"]["id"])
        if not home or not away:
            continue
        pat = re.compile(r'(\{ md: \d+, h: "%s", a: "%s")(?!, hs:)(, day: "[^"]*")?' % (re.escape(home), re.escape(away)))
        m = pat.search(src)
        if not m:
            continue  # already has a score, or not in the league phase
        hs, as_ = int(g["homeCompetitor"]["score"]), int(g["awayCompetitor"]["score"])
        src = src[:m.start()] + f"{m.group(1)}, hs: {hs}, as: {as_}" + src[m.end():]
        added.append(f"{home} {hs}-{as_} {away}")
    if added:
        DATA.write_text(src)
    print(f"Added {len(added)} results.")
    for a in added:
        print("  " + a)


if __name__ == "__main__":
    main()
