"""Typed models used by the application."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import re

from nba_consistency_stats.config import VALID_SEASON_TYPES

NBA_SEASON_FORMAT_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")


@dataclass(frozen=True)
class SeasonSelection:
    """Represents one NBA season and season type selection."""

    season: str
    season_type: str

    @classmethod
    def from_user_input(cls, season: str, season_type: str) -> "SeasonSelection":
        normalized_season = season.strip()
        normalized_type = season_type.strip()

        match = NBA_SEASON_FORMAT_PATTERN.fullmatch(normalized_season)
        if not match:
            raise ValueError("Season must use the YYYY-YY format, for example 2024-25.")

        start_year = int(match.group(1))
        end_year = int(match.group(2))
        expected_end = (start_year + 1) % 100
        if end_year != expected_end:
            raise ValueError("Season end year must match the following NBA season year.")

        if normalized_type not in VALID_SEASON_TYPES:
            allowed = ", ".join(VALID_SEASON_TYPES)
            raise ValueError(f"Season type must be one of: {allowed}.")

        return cls(season=normalized_season, season_type=normalized_type)

    @property
    def key(self) -> tuple[str, str]:
        return (self.season, self.season_type)


@dataclass(frozen=True)
class PlayerRef:
    """Minimal player identity used during season fetches."""

    player_id: int
    player_name: str


@dataclass(frozen=True)
class StatSummary:
    """Summary metrics for one stat across a player's game log."""

    stat_name: str
    average: float
    standard_deviation: float
    consistency_rating: float | None


@dataclass(frozen=True)
class PlayerConsistencySummary:
    """Complete consistency summary for one player and one season."""

    player_id: int
    player_name: str
    games_played: int
    statistics: list[StatSummary]


@dataclass(frozen=True)
class LoadedSeasonRecord:
    """Stored metadata for a previously loaded season."""

    season: str
    season_type: str
    player_count: int
    stat_count: int
    failed_player_count: int
    loaded_at: datetime


@dataclass(frozen=True)
class SeasonLoadReport:
    """Result metadata after loading a season into the database."""

    selection: SeasonSelection
    player_count: int
    stat_count: int
    failed_player_count: int
    failed_players: list[str] = field(default_factory=list)
