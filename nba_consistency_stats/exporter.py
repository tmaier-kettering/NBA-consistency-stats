"""Export NBA consistency stats from SQLite to JSON for the web frontend."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path

from nba_consistency_stats.config import DATA_DIR

DEFAULT_WEB_OUTPUT_PATH = DATA_DIR / "web" / "stats.json"
DEFAULT_GAMELOGS_DIR = DATA_DIR / "web" / "gamelogs"

# Fields in raw game log rows that are not player performance stats
_GAMELOG_EXCLUDED_FIELDS = {
    "PLAYER_ID",
    "Player_ID",
    "SEASON_ID",
    "Game_ID",
    "GAME_ID",
    "VIDEO_AVAILABLE",
}


def _compute_ranks_and_percentiles(player_list: list[dict]) -> None:
    """Add ``rank`` and ``pct`` fields to every stat entry in *player_list*.

    Rank 1 = highest CR for that stat (same as 100th percentile).
    Only players with a non-null CR participate in the ranking.
    Standard competition ranking is used for ties.
    """
    all_stat_names: set[str] = set()
    for p in player_list:
        all_stat_names.update(p["stats"].keys())

    for stat in all_stat_names:
        # Collect (list-index, cr_value) for players with a valid CR
        indexed: list[tuple[int, float]] = [
            (i, p["stats"][stat]["cr"])
            for i, p in enumerate(player_list)
            if stat in p["stats"] and p["stats"][stat]["cr"] is not None
        ]

        if not indexed:
            continue

        n = len(indexed)
        # Sort descending so the highest CR comes first
        sorted_indexed = sorted(indexed, key=lambda x: x[1], reverse=True)

        # Assign competition ranks (ties share the lowest rank in the group)
        ranks: dict[int, int] = {}
        pos = 0
        while pos < n:
            end = pos
            while end < n and sorted_indexed[end][1] == sorted_indexed[pos][1]:
                end += 1
            rank_value = pos + 1
            for k in range(pos, end):
                ranks[sorted_indexed[k][0]] = rank_value
            pos = end

        # Write rank and percentile back into player_list
        for player_idx, _ in indexed:
            r = ranks[player_idx]
            pct = round((n - r + 1) / n * 100)
            player_list[player_idx]["stats"][stat]["rank"] = r
            player_list[player_idx]["stats"][stat]["pct"] = pct


def export_stats_to_json(
    database_path: Path,
    output_path: Path = DEFAULT_WEB_OUTPUT_PATH,
    progress_callback: Callable[[str], None] | None = None,
) -> None:
    """Read the SQLite database and write ``stats.json`` for the web frontend.

    Call this after every season load so the website reflects the latest data.
    Each stat entry now includes ``rank`` and ``pct`` (percentile) fields
    in addition to ``cr``, ``avg``, and ``std``.
    """

    progress = progress_callback or (lambda _message: None)

    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute(
        "SELECT DISTINCT season FROM player_consistency_stats ORDER BY season DESC"
    )
    seasons = [r[0] for r in c.fetchall()]

    c.execute(
        """SELECT DISTINCT season, season_type
           FROM player_consistency_stats
           ORDER BY season DESC, season_type"""
    )
    combos = c.fetchall()

    output: dict = {"seasons": seasons, "data": {}}

    for combo in combos:
        season, season_type = combo["season"], combo["season_type"]
        key = f"{season}|{season_type}"

        c.execute(
            """SELECT DISTINCT player_id, player_name, games_played
               FROM player_consistency_stats
               WHERE season = ? AND season_type = ?
               ORDER BY player_name""",
            (season, season_type),
        )
        players = c.fetchall()

        player_list = []
        for p in players:
            c.execute(
                """SELECT stat_name, average, standard_deviation, consistency_rating
                   FROM player_consistency_stats
                   WHERE season = ? AND season_type = ? AND player_id = ?""",
                (season, season_type, p["player_id"]),
            )
            stats_rows = c.fetchall()

            stats_dict: dict = {}
            for s in stats_rows:
                cr = s["consistency_rating"]
                stats_dict[s["stat_name"]] = {
                    "cr": round(cr, 4) if cr is not None else None,
                    "avg": round(s["average"], 4),
                    "std": round(s["standard_deviation"], 4),
                }

            player_list.append(
                {
                    "id": p["player_id"],
                    "name": p["player_name"],
                    "gp": p["games_played"],
                    "stats": stats_dict,
                }
            )

        _compute_ranks_and_percentiles(player_list)

        output["data"][key] = player_list
        progress(f"Exported {key}: {len(player_list)} players")

    conn.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    total = sum(len(v) for v in output["data"].values())
    progress(f"stats.json updated — {total} player-season records written to {output_path}")


def export_game_logs_to_json(
    database_path: Path,
    output_dir: Path = DEFAULT_GAMELOGS_DIR,
    progress_callback: Callable[[str], None] | None = None,
) -> None:
    """Export per-player game log values to per-season JSON files.

    One file is written per season/type combination:
      ``output_dir/{season}_{season_type}.json``

    Each file maps player ID (as a string) to a dict of stat arrays::

        {"2544": {"PTS": [25, 30, ...], "REB": [8, 5, ...]}, ...}

    Call this after every season load alongside :func:`export_stats_to_json`.
    """

    progress = progress_callback or (lambda _message: None)

    output_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(database_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute(
        """SELECT DISTINCT season, season_type
           FROM player_game_logs
           ORDER BY season DESC, season_type"""
    )
    combos = c.fetchall()

    for combo in combos:
        season, season_type = combo["season"], combo["season_type"]

        c.execute(
            """SELECT player_id, row_json
               FROM player_game_logs
               WHERE season = ? AND season_type = ?""",
            (season, season_type),
        )
        rows = c.fetchall()

        player_logs: dict[str, dict[str, list]] = {}
        for row in rows:
            pid = str(row["player_id"])
            game_data: dict = json.loads(row["row_json"])

            if pid not in player_logs:
                player_logs[pid] = {}

            for field, value in game_data.items():
                if field in _GAMELOG_EXCLUDED_FIELDS:
                    continue
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    continue
                if field not in player_logs[pid]:
                    player_logs[pid][field] = []
                player_logs[pid][field].append(value)

        filename = f"{season}_{season_type.replace(' ', '_')}.json"
        output_path = output_dir / filename
        with open(output_path, "w") as f:
            json.dump(player_logs, f, separators=(",", ":"))

        progress(f"Game logs exported for {season} {season_type}: {len(player_logs)} players → {output_path.name}")

    conn.close()
