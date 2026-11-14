#!/usr/bin/env python3
"""Pull Winner's 1/X/2 odds for upcoming Champions League games and write
them into data.js.

365Scores shows Winner's prices (bookmaker 1 for Israeli users) once Winner
opens a market, usually a few days before kickoff. Games without a market
yet are left alone; games already played are never touched. Run it as often
as you like: it only rewrites a line when the prices changed.

    python3 champions-league/tools/fetch_odds.py
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.request

DATA = pathlib.Path(__file__).resolve().parent.parent / "data.js"
URL = ("https://webws.365scores.com/web/games/fixtures/"
       "?appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6"
       "&competitions=572&showOdds=true")
WINNER = 1   # 365Scores bookmaker id for Winner
MATCH_RESULT = 1  # line type: 1 / X / 2

# 365Scores competitor id -> team name used in data.js
TEAM_IDS = {
    104: "Arsenal", 109: "Aston Villa", 108: "Liverpool", 110: "Man City", 105: "Man United",
    132: "Barcelona", 134: "Atletico Madrid", 131: "Real Madrid", 146: "Real Betis", 133: "Villarreal",
    224: "Inter", 234: "Napoli", 225: "Roma", 6117: "Como",
    331: "Bayern", 341: "Dortmund", 7171: "RB Leipzig", 338: "Stuttgart",
    480: "PSG", 481: "Lens", 478: "Lille", 890: "Sporting CP", 887: "Porto",
    725: "PSV", 691: "Feyenoord", 945: "Galatasaray", 946: "Fenerbahce",
    1169: "Club Brugge", 1789: "Slavia Praha", 1743: "LASK", 1024: "AEK Athens",
    1955: "Shakhtar", 1978: "Bodo/Glimt", 1980: "Viking", 2112: "Slovan Bratislava", 50201: "Sabah",
}


def fetch_odds():
    with urllib.request.urlopen(URL, timeout=30) as resp:
        games = json.load(resp).get("games", [])
    found = {}
    for g in games:
        line = g.get("odds")
        if not line or line.get("bookmakerId") != WINNER or line.get("lineTypeId") != MATCH_RESULT:
            continue
        rates = {o["name"]: o["rate"]["decimal"] for o in line.get("options", [])}
        if not all(k in rates for k in ("1", "X", "2")):
            continue
        home = TEAM_IDS.get(g["homeCompetitor"]["id"])
        away = TEAM_IDS.get(g["awayCompetitor"]["id"])
        if home and away:
            found[(home, away)] = [rates["1"], rates["X"], rates["2"]]
        else:
            print(f"unknown team id in game {g['id']}", file=sys.stderr)
    return found


def write_odds(found):
    src = DATA.read_text()
    stamp = datetime.date.today().strftime("%b %-d")
    changed = []
    for (home, away), odds in found.items():
        pat = re.compile(r'^(  \{ md: \d+, h: "%s", a: "%s"(?!, hs:)[^\n]*?)( \},?)$' % (re.escape(home), re.escape(away)), re.M)
        m = pat.search(src)
        if not m:
            continue  # already played, or not a league-phase fixture
        body = re.sub(r", odds: \[[^\]]*\], oddsDate: \"[^\"]*\"", "", m.group(1))
        new = f'{body}, odds: [{", ".join(f"{x:.2f}" for x in odds)}], oddsDate: "{stamp}"{m.group(2)}'
        old_odds = re.search(r"odds: \[([^\]]*)\]", m.group(1))
        if old_odds and [float(x) for x in old_odds.group(1).split(",")] == odds:
            continue
        src = src[:m.start()] + new + src[m.end():]
        changed.append(f"{home} - {away}: {odds}")
    if changed:
        DATA.write_text(src)
    return changed


if __name__ == "__main__":
    found = fetch_odds()
    changed = write_odds(found)
    print(f"Winner odds found for {len(found)} games; updated {len(changed)}.")
    for c in changed:
        print("  " + c)
