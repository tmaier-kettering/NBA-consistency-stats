"""Command-line entry points for the application."""

from __future__ import annotations

import argparse
from pathlib import Path

from nba_consistency_stats.config import DEFAULT_DATABASE_PATH, DEFAULT_HOST, DEFAULT_PORT, VALID_SEASON_TYPES
from nba_consistency_stats.database import ConsistencyDatabase
from nba_consistency_stats.gui import launch_admin_ui
from nba_consistency_stats.models import SeasonSelection
from nba_consistency_stats.nba_api_client import NbaApiClient
from nba_consistency_stats.service import ConsistencyStatsService


def build_argument_parser() -> argparse.ArgumentParser:
    """Create the CLI argument parser."""

    parser = argparse.ArgumentParser(description="NBA consistency stats admin tool")
    parser.add_argument("--database", default=str(DEFAULT_DATABASE_PATH), help="Path to the SQLite database file.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host interface for the admin UI.")
    parser.add_argument("--port", default=DEFAULT_PORT, type=int, help="Port for the admin UI.")
    parser.add_argument(
        "--season",
        help="Optional direct-load mode. Provide a season like 2024-25 to fetch without opening the UI.",
    )
    parser.add_argument(
        "--season-type",
        default=VALID_SEASON_TYPES[0],
        choices=VALID_SEASON_TYPES,
        help="Season type for direct-load mode.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not automatically open a browser tab when starting the UI.",
    )
    return parser


def main() -> int:
    """Run the browser UI or perform a direct season load."""

    parser = build_argument_parser()
    args = parser.parse_args()

    database = ConsistencyDatabase(Path(args.database))
    service = ConsistencyStatsService(database=database, client=NbaApiClient())

    if args.season:
        selection = SeasonSelection.from_user_input(args.season, args.season_type)
        report = service.load_season(selection, progress_callback=print)
        print(
            f"Loaded {report.selection.season} ({report.selection.season_type}) with "
            f"{report.player_count} players and {report.stat_count} stat summaries."
        )
        if report.failed_player_count:
            print(f"Skipped {report.failed_player_count} players after repeated API failures.")
        return 0

    launch_admin_ui(service, host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0
