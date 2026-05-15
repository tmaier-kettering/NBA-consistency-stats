"""Export NBA consistency stats from SQLite to JSON for the web frontend."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from pathlib import Path

from nba_consistency_stats.config import DATA_DIR

DEFAULT_WEB_OUTPUT_PATH = DATA_DIR / "web" / "stats.json"


def export_stats_to_json(
    database_path: Path,
    output_path: Path = DEFAULT_WEB_OUTPUT_PATH,
    progress_callback: Callable[[str], None] | None = None,
) -> None:
    """Read the SQLite database and write ``stats.json`` for the web frontend.

    Call this after every season load so the website reflects the latest data.
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

        output["data"][key] = player_list
        progress(f"Exported {key}: {len(player_list)} players")

    conn.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    total = sum(len(v) for v in output["data"].values())
    progress(f"stats.json updated — {total} player-season records written to {output_path}")
