"""SQLite persistence layer for season summaries."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from nba_consistency_stats.config import DEFAULT_DATABASE_PATH
from nba_consistency_stats.models import LoadedSeasonRecord, PlayerConsistencySummary, SeasonSelection


class SeasonAlreadyLoadedError(RuntimeError):
    """Raised when a caller tries to fetch a season that already exists."""


class ConsistencyDatabase:
    """Wrapper around the SQLite database used by the tool."""

    def __init__(self, database_path: Path = DEFAULT_DATABASE_PATH) -> None:
        self.database_path = Path(database_path)

    def initialize(self) -> None:
        """Create the database schema if it does not already exist."""

        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS season_loads (
                    season TEXT NOT NULL,
                    season_type TEXT NOT NULL,
                    player_count INTEGER NOT NULL,
                    stat_count INTEGER NOT NULL,
                    failed_player_count INTEGER NOT NULL DEFAULT 0,
                    loaded_at TEXT NOT NULL,
                    PRIMARY KEY (season, season_type)
                );

                CREATE TABLE IF NOT EXISTS player_consistency_stats (
                    season TEXT NOT NULL,
                    season_type TEXT NOT NULL,
                    player_id INTEGER NOT NULL,
                    player_name TEXT NOT NULL,
                    games_played INTEGER NOT NULL,
                    stat_name TEXT NOT NULL,
                    average REAL NOT NULL,
                    standard_deviation REAL NOT NULL,
                    consistency_rating REAL,
                    PRIMARY KEY (season, season_type, player_id, stat_name),
                    FOREIGN KEY (season, season_type)
                        REFERENCES season_loads (season, season_type)
                        ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_player_consistency_lookup
                    ON player_consistency_stats (season, season_type, player_name, stat_name);
                """
            )

    def connect(self) -> sqlite3.Connection:
        """Create a configured SQLite connection."""

        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def season_exists(self, selection: SeasonSelection) -> bool:
        """Return True when the selected season is already stored."""

        with self.connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM season_loads WHERE season = ? AND season_type = ?",
                selection.key,
            ).fetchone()
        return row is not None

    def list_loaded_seasons(self) -> list[LoadedSeasonRecord]:
        """Return all stored season loads ordered from newest to oldest."""

        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT season, season_type, player_count, stat_count, failed_player_count, loaded_at
                FROM season_loads
                ORDER BY season DESC, season_type ASC
                """
            ).fetchall()

        return [
            LoadedSeasonRecord(
                season=row["season"],
                season_type=row["season_type"],
                player_count=row["player_count"],
                stat_count=row["stat_count"],
                failed_player_count=row["failed_player_count"],
                loaded_at=datetime.fromisoformat(row["loaded_at"]),
            )
            for row in rows
        ]

    def save_season(
        self,
        selection: SeasonSelection,
        player_summaries: list[PlayerConsistencySummary],
        failed_player_count: int,
    ) -> None:
        """Persist one loaded season and all calculated player stats."""

        stat_count = sum(len(summary.statistics) for summary in player_summaries)
        loaded_at = datetime.now(UTC).isoformat(timespec="seconds")

        try:
            with self.connect() as connection:
                connection.execute(
                    """
                    INSERT INTO season_loads (
                        season,
                        season_type,
                        player_count,
                        stat_count,
                        failed_player_count,
                        loaded_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        selection.season,
                        selection.season_type,
                        len(player_summaries),
                        stat_count,
                        failed_player_count,
                        loaded_at,
                    ),
                )
                connection.executemany(
                    """
                    INSERT INTO player_consistency_stats (
                        season,
                        season_type,
                        player_id,
                        player_name,
                        games_played,
                        stat_name,
                        average,
                        standard_deviation,
                        consistency_rating
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            selection.season,
                            selection.season_type,
                            summary.player_id,
                            summary.player_name,
                            summary.games_played,
                            stat.stat_name,
                            stat.average,
                            stat.standard_deviation,
                            stat.consistency_rating,
                        )
                        for summary in player_summaries
                        for stat in summary.statistics
                    ],
                )
        except sqlite3.IntegrityError as error:
            raise SeasonAlreadyLoadedError(
                f"{selection.season} ({selection.season_type}) is already stored in the database."
            ) from error
