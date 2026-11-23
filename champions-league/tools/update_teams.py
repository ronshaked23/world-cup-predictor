#!/usr/bin/env python3
"""Refresh every team's current-season data in data.js from 365Scores.

For each of the 36 clubs it writes:
  dom     — domestic league record and position (from the league table)
  venue10 — last 10 competitive home games and last 10 away games (domestic
            league + UEFA competitions; cups and friendlies left out)
  checked / lastGame — when this ran, and the date of the club's latest game

365Scores covers every league in the competition, including the Czech,
Ukrainian, Slovak and Azerbaijani ones ESPN doesn't, so no team goes stale.
Ends with a freshness report; exits non-zero if a team couldn't be updated.

    python3 champions-league/tools/update_teams.py
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_odds import TEAM_IDS  # noqa: E402  (365Scores id -> data.js name)

DATA = pathlib.Path(__file__).resolve().parent.parent / "data.js"
API = "https://webws.365scores.com"
Q = "appTypeId=5&langId=1&timezoneName=Asia/Jerusalem&userCountryId=6"
STALE_DAYS = 14  # a club with no game for this long gets flagged in the report


def get(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=30) as resp:
        return json.load(resp)


def is_competitive(comp_id, comp_name, league_id):
    if comp_id == league_id:
        return True
    return "UEFA" in comp_name and not re.search(r"Super Cup|Youth|Women", comp_name)


def team_games(team_id):
    """Finished games, newest first, plus the club's main league id."""
    data = get(f"/web/games/results/?{Q}&competitors={team_id}")
    league_id = next((c.get("mainCompetitionId") for c in data.get("competitors", []) if c["id"] == team_id), None)
    games, pages = [], 0
    while True:
        names = {c["id"]: c["name"] for c in data.get("competitions", [])}
        for g in data.get("games", []):
            if g.get("statusGroup") != 4:  # 4 = ended
                continue
            home = g["homeCompetitor"]["id"] == team_id
            me, opp = (g["homeCompetitor"], g["awayCompetitor"]) if home else (g["awayCompetitor"], g["homeCompetitor"])
            games.append({
                "date": g["startTime"][:10], "home": home,
                "gf": int(me["score"]), "ga": int(opp["score"]),
                "comp": g["competitionId"], "compName": names.get(g["competitionId"], ""),
            })
        comp = [x for x in games if is_competitive(x["comp"], x["compName"], league_id)]
        enough = sum(x["home"] for x in comp) >= 10 and sum(not x["home"] for x in comp) >= 10
        prev = data.get("paging", {}).get("previousPage")
        pages += 1
        if enough or not prev or pages >= 6:
            break
        data = get(prev)
    games.sort(key=lambda x: x["date"], reverse=True)
    return league_id, [x for x in games if is_competitive(x["comp"], x["compName"], league_id)]


def league_row(league_id, team_id, cache={}):
    if league_id not in cache:
        cache[league_id] = get(f"/web/standings/?{Q}&competitions={league_id}").get("standings", [])
    for table in cache[league_id]:
        for pos, row in enumerate(table.get("rows", []), 1):
            if row["competitor"]["id"] == team_id:
                return row, row.get("position") or pos
    return None, None


def venue_record(games, home):
    sample = [g for g in games if g["home"] == home][:10]
    rec = [sum(g["gf"] > g["ga"] for g in sample), sum(g["gf"] == g["ga"] for g in sample), sum(g["gf"] < g["ga"] for g in sample)]
    goals = [sum(g["gf"] for g in sample), sum(g["ga"] for g in sample)]
    return rec, goals, (sample[-1]["date"] if sample else "")


def main():
    src = DATA.read_text()
    today = datetime.date.today()
    stamp = today.strftime("%b %-d")
    report, failed = [], []
    for team_id, name in TEAM_IDS.items():
        try:
            league_id, games = team_games(team_id)
            row, pos = league_row(league_id, team_id)
        except Exception as e:  # keep going: one bad response shouldn't block the other 35
            failed.append(f"{name}: {e}")
            continue
        block = re.search(r'(  "%s": \{ league:.*?\n)(    blurb:)' % re.escape(name), src, re.S)
        if not block or not row or not games:
            failed.append(f"{name}: {'no data.js entry' if not block else 'no league row' if not row else 'no games'}")
            continue
        hrec, hgoals, hsince = venue_record(games, True)
        arec, agoals, asince = venue_record(games, False)
        last = games[0]["date"]
        dom = (f'dom: {{ gp: {row["gamePlayed"]}, w: {row["gamesWon"]}, d: {row["gamesEven"]}, l: {row["gamesLost"]}, '
               f'gf: {int(row["for"])}, ga: {int(row["against"])}, pos: {pos} }},')
        ven = (f'venue10: {{ home: {hrec}, away: {arec}, homeGoals: {hgoals}, awayGoals: {agoals}, '
               f'since: ["{hsince}", "{asince}"] }},')
        chk = f'checked: "{stamp}", lastGame: "{last}",'
        body = block.group(1)
        body = re.sub(r"    dom: \{[^\n]*\n", f"    {dom}\n", body)
        body = re.sub(r"    venue10: \{[^\n]*\n", "", body)
        body = re.sub(r"    checked: [^\n]*\n", "", body)
        body += f"    {ven}\n    {chk}\n"
        src = src.replace(block.group(0), body + block.group(2), 1)
        age = (today - datetime.date.fromisoformat(last)).days
        report.append((age, name, last, pos, row))
    DATA.write_text(src)

    print(f"Updated {len(report)} of {len(TEAM_IDS)} teams.")
    for age, name, last, pos, row in sorted(report, reverse=True):
        flag = "  STALE" if age > STALE_DAYS else ""
        print(f"  {name:18} last game {last} ({age}d ago) · {pos}. in league, "
              f"{row['gamesWon']}-{row['gamesEven']}-{row['gamesLost']}{flag}")
    for f in failed:
        print("  FAILED " + f)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
