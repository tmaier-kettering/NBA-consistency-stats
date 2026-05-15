"""Stat calculation utilities."""

from __future__ import annotations

from math import isfinite
from statistics import mean, stdev
from typing import Iterable

from nba_consistency_stats.models import PlayerConsistencySummary, PlayerRef, StatSummary

EXCLUDED_NUMERIC_FIELDS = {
    "PLAYER_ID",
    "Player_ID",
    "SEASON_ID",
    "Game_ID",
    "GAME_ID",
    "VIDEO_AVAILABLE",
}


def _is_numeric_value(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _round_metric(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 4)


def calculate_consistency_metrics(values: Iterable[float]) -> tuple[float, float, float | None]:
    """Return average, standard deviation, and consistency rating for a sequence."""

    series = [float(value) for value in values]
    if not series:
        raise ValueError("At least one numeric value is required to calculate consistency metrics.")

    average = mean(series)
    standard_deviation = stdev(series) if len(series) > 1 else 0.0

    if standard_deviation <= 0 or not isfinite(standard_deviation):
        consistency_rating = None
    else:
        consistency_rating = average / standard_deviation

    return (
        _round_metric(average) or 0.0,
        _round_metric(standard_deviation) or 0.0,
        _round_metric(consistency_rating),
    )


def build_player_summary(player: PlayerRef, game_log_rows: list[dict[str, object]]) -> PlayerConsistencySummary:
    """Create consistency summaries for every numeric stat in a player's game log."""

    if not game_log_rows:
        raise ValueError(f"No game log rows were returned for {player.player_name}.")

    stat_names: list[str] = []
    seen_stat_names: set[str] = set()

    for row in game_log_rows:
        for key, value in row.items():
            if key in EXCLUDED_NUMERIC_FIELDS or not _is_numeric_value(value):
                continue
            if key not in seen_stat_names:
                seen_stat_names.add(key)
                stat_names.append(key)

    statistics = [
        StatSummary(
            stat_name=stat_name,
            average=average,
            standard_deviation=standard_deviation,
            consistency_rating=consistency_rating,
        )
        for stat_name in stat_names
        for average, standard_deviation, consistency_rating in [
            calculate_consistency_metrics(
                row[stat_name]
                for row in game_log_rows
                if _is_numeric_value(row.get(stat_name))
            )
        ]
    ]

    if not statistics:
        raise ValueError(f"No numeric stats were available for {player.player_name}.")

    return PlayerConsistencySummary(
        player_id=player.player_id,
        player_name=player.player_name,
        games_played=len(game_log_rows),
        statistics=statistics,
    )
