"""
Export NBA consistency stats from SQLite to JSON for the web frontend.
Run this script whenever new data is loaded into the database.

The export now runs automatically after every season load in the admin tool,
so you only need to run this script manually if you modify the database directly.
"""

from nba_consistency_stats.config import DEFAULT_DATABASE_PATH
from nba_consistency_stats.exporter import export_stats_to_json


def export() -> None:
    export_stats_to_json(DEFAULT_DATABASE_PATH, progress_callback=print)


if __name__ == "__main__":
    export()
