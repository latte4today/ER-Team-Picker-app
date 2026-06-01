"""Collect Eternal Return match data with a personal API key.

This script is intentionally conservative: it waits between requests and stores
raw responses so repeated runs do not need to fetch the same games again.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE_URL = os.environ.get("ER_API_BASE_URL", "https://open-api.bser.io")
API_KEY = os.environ.get("ER_API_KEY", "")
REQUEST_INTERVAL_SECONDS = float(os.environ.get("ER_REQUEST_INTERVAL_SECONDS", "1.1"))
DB_PATH = Path(os.environ.get("ER_DB_PATH", "data/er_matches.sqlite"))


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        create table if not exists api_cache (
            cache_key text primary key,
            fetched_at integer not null,
            payload text not null
        )
        """
    )
    conn.execute(
        """
        create table if not exists games (
            game_id integer primary key,
            fetched_at integer not null,
            payload text not null
        )
        """
    )
    return conn


def request_json(path: str, params: dict[str, str] | None = None) -> dict:
    if not API_KEY:
        raise SystemExit("ER_API_KEY 환경 변수가 필요합니다.")

    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{BASE_URL}{path}{query}"
    request = urllib.request.Request(url, headers={"x-api-key": API_KEY})

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            time.sleep(REQUEST_INTERVAL_SECONDS)
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"API 요청 실패: {exc.code} {body}") from exc


def cached_request(conn: sqlite3.Connection, cache_key: str, path: str, params: dict[str, str] | None = None) -> dict:
    row = conn.execute("select payload from api_cache where cache_key = ?", (cache_key,)).fetchone()
    if row:
        return json.loads(row[0])

    payload = request_json(path, params)
    conn.execute(
        "insert or replace into api_cache values (?, ?, ?)",
        (cache_key, int(time.time()), json.dumps(payload, ensure_ascii=False)),
    )
    conn.commit()
    return payload


def collect_top_rankers(conn: sqlite3.Connection, season: int, server: str, team_mode: int, limit: int) -> list[int]:
    payload = cached_request(
        conn,
        f"rank-top:{season}:{server}:{team_mode}",
        f"/v2/rank/top/{season}/{server}/{team_mode}",
    )
    rankers = payload.get("topRanks") or payload.get("userRankList") or payload.get("ranks") or []
    user_nums = []
    for ranker in rankers[:limit]:
        user_num = ranker.get("userNum") or ranker.get("user_num")
        if user_num is not None:
            user_nums.append(int(user_num))
    return user_nums


def collect_user_games(conn: sqlite3.Connection, user_num: int) -> list[int]:
    payload = cached_request(conn, f"user-games:{user_num}", f"/v1/user/games/{user_num}")
    games = payload.get("userGames") or payload.get("games") or []
    game_ids = []
    for game in games:
        game_id = game.get("gameId") or game.get("game_id")
        if game_id is not None:
            game_ids.append(int(game_id))
    return game_ids


def collect_game(conn: sqlite3.Connection, game_id: int) -> None:
    row = conn.execute("select 1 from games where game_id = ?", (game_id,)).fetchone()
    if row:
        return

    payload = request_json(f"/v1/games/{game_id}")
    conn.execute(
        "insert or replace into games values (?, ?, ?)",
        (game_id, int(time.time()), json.dumps(payload, ensure_ascii=False)),
    )
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--server", default="SEOUL")
    parser.add_argument("--team-mode", type=int, default=3)
    parser.add_argument("--rankers", type=int, default=20)
    parser.add_argument("--games-per-user", type=int, default=20)
    args = parser.parse_args()

    with connect_db() as conn:
        user_nums = collect_top_rankers(conn, args.season, args.server, args.team_mode, args.rankers)
        print(f"rankers: {len(user_nums)}")

        game_ids: set[int] = set()
        for user_num in user_nums:
            game_ids.update(collect_user_games(conn, user_num)[: args.games_per_user])
        print(f"unique games: {len(game_ids)}")

        for index, game_id in enumerate(sorted(game_ids), start=1):
            collect_game(conn, game_id)
            print(f"game {index}/{len(game_ids)} saved: {game_id}")


if __name__ == "__main__":
    main()
