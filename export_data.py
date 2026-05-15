"""
Export NBA consistency stats from SQLite to JSON for the web frontend.
Run this script whenever new data is loaded into the database.
"""

import sqlite3
import json
import os


def export():
    db_path = os.path.join(os.path.dirname(__file__), "data", "nba_consistency_stats.sqlite3")
    out_dir = os.path.join(os.path.dirname(__file__), "data", "web")
    out_path = os.path.join(out_dir, "stats.json")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Available seasons (most recent first)
    c.execute(
        "SELECT DISTINCT season FROM player_consistency_stats ORDER BY season DESC"
    )
    seasons = [r[0] for r in c.fetchall()]

    # All season / season_type combinations
    c.execute(
        """SELECT DISTINCT season, season_type
           FROM player_consistency_stats
           ORDER BY season DESC, season_type"""
    )
    combos = c.fetchall()

    output = {"seasons": seasons, "data": {}}

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

            stats_dict = {}
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
        print(f"  {key}: {len(player_list)} players")

    conn.close()

    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    total = sum(len(v) for v in output["data"].values())
    print(f"\nExported {total} player-season records → {out_path}")


if __name__ == "__main__":
    export()
