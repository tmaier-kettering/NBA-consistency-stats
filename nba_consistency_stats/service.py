"""High-level application workflow for loading seasons."""

from __future__ import annotations

from collections.abc import Callable

from nba_consistency_stats.database import ConsistencyDatabase, SeasonAlreadyLoadedError
from nba_consistency_stats.models import PlayerRef, SeasonLoadReport, SeasonSelection
from nba_consistency_stats.nba_api_client import NbaApiClient
from nba_consistency_stats.statistics import build_player_summary

ProgressCallback = Callable[[str], None]


class ConsistencyStatsService:
    """Coordinates API fetches, stat calculations, and database writes."""

    def __init__(self, database: ConsistencyDatabase, client: NbaApiClient) -> None:
        self.database = database
        self.client = client
        self.database.initialize()

    def list_loaded_seasons(self):
        """Return stored seasons for display in the admin UI."""

        return self.database.list_loaded_seasons()

    def load_season(
        self,
        selection: SeasonSelection,
        progress_callback: ProgressCallback | None = None,
    ) -> SeasonLoadReport:
        """Fetch one season, calculate consistency stats, and persist the results."""

        if self.database.season_exists(selection):
            raise SeasonAlreadyLoadedError(
                f"{selection.season} ({selection.season_type}) is already in the database."
            )

        progress = progress_callback or (lambda _message: None)
        progress(f"Finding players for {selection.season} ({selection.season_type})...")

        players = self.client.list_players_for_season(selection)
        if not players:
            raise RuntimeError(
                f"No player data was returned for {selection.season} ({selection.season_type})."
            )

        summaries = []
        failed_players: list[str] = []
        total_players = len(players)

        for index, player in enumerate(players, start=1):
            progress(f"Fetching {player.player_name} ({index}/{total_players})...")
            try:
                game_log_rows = self.client.fetch_player_game_log(player, selection)
                summaries.append(build_player_summary(player, game_log_rows))
            except Exception as error:
                failed_players.append(self._format_player_error(player, error))
                progress(f"Skipping {player.player_name}: {error}")

        if not summaries:
            raise RuntimeError("No player summaries were created; the season was not saved.")

        self.database.save_season(
            selection=selection,
            player_summaries=summaries,
            failed_player_count=len(failed_players),
        )
        progress(f"Saved {selection.season} ({selection.season_type}) to the database.")

        return SeasonLoadReport(
            selection=selection,
            player_count=len(summaries),
            stat_count=sum(len(summary.statistics) for summary in summaries),
            failed_player_count=len(failed_players),
            failed_players=failed_players,
        )

    @staticmethod
    def _format_player_error(player: PlayerRef, error: Exception) -> str:
        return f"{player.player_name} ({player.player_id}): {error}"
