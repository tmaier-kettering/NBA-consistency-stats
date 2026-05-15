"""API client for retrieving NBA data with retry protection."""

from __future__ import annotations

import random
import threading
import time
from typing import Any

from requests.exceptions import ReadTimeout, RequestException

from nba_consistency_stats.models import PlayerRef, SeasonSelection


class MissingDependencyError(RuntimeError):
    """Raised when optional third-party packages are not installed."""


# Maximum extra seconds added randomly after each rate-limiter slot reservation.
# A small jitter reduces the chance that multiple concurrent workers hit the API
# in a tight burst even when the global slot interval has just elapsed.
_JITTER_RANGE: float = 0.25


class _RateLimiter:
    """Thread-safe rate limiter that enforces a minimum interval between requests.

    Multiple concurrent callers share a single global slot queue: each call to
    ``acquire()`` blocks until at least ``min_interval`` seconds have elapsed
    since the previous request was granted, then reserves the next slot.  This
    keeps the aggregate request rate at or below ``1 / min_interval`` req/s
    regardless of how many worker threads are active.
    """

    def __init__(self, min_interval: float) -> None:
        self._lock = threading.Lock()
        self._next_allowed: float = 0.0
        self._min_interval = min_interval

    def acquire(self) -> None:
        """Block until a request slot is available, then reserve the next slot."""
        if self._min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            wait = self._next_allowed - now
            if wait > 0:
                time.sleep(wait)
            # Reserve the slot; add a small random jitter to smooth burst edges.
            self._next_allowed = time.monotonic() + self._min_interval + random.uniform(0, _JITTER_RANGE)


class NbaApiClient:
    """Thin wrapper over nba_api that standardizes responses and retries."""

    def __init__(self, timeout: int = 60, max_retries: int = 5, pause_seconds: float = 0.35) -> None:
        self.timeout = timeout
        self.max_retries = max_retries
        self.pause_seconds = pause_seconds
        self._rate_limiter = _RateLimiter(pause_seconds)

    def list_players_for_season(self, selection: SeasonSelection) -> list[PlayerRef]:
        """Return the distinct players that appeared in the selected season."""

        endpoint = self._create_league_game_finder(selection)
        rows = self._extract_rows(endpoint)
        players_by_id: dict[int, PlayerRef] = {}

        for row in rows:
            player_id = row.get("PLAYER_ID")
            player_name = row.get("PLAYER_NAME")
            if not isinstance(player_id, int) or not isinstance(player_name, str):
                continue
            players_by_id[player_id] = PlayerRef(player_id=player_id, player_name=player_name)

        return sorted(players_by_id.values(), key=lambda player: player.player_name.casefold())

    def fetch_player_game_log(self, player: PlayerRef, selection: SeasonSelection) -> list[dict[str, Any]]:
        """Return a player's game log rows for the selected season."""

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                self._rate_limiter.acquire()
                endpoint = self._create_player_game_log(player, selection)
                rows = self._extract_rows(endpoint)
                return rows
            except (ReadTimeout, RequestException, ValueError) as error:
                last_error = error
                if attempt == self.max_retries:
                    break
                sleep_seconds = (2 ** attempt) + random.uniform(0, 1)
                time.sleep(sleep_seconds)

        if last_error is None:
            raise RuntimeError(f"Unknown failure while retrieving data for {player.player_name}.")
        raise RuntimeError(
            f"Unable to retrieve data for {player.player_name} after {self.max_retries} attempts."
        ) from last_error

    def _create_league_game_finder(self, selection: SeasonSelection) -> Any:
        leaguegamefinder, _ = self._import_endpoints()
        return leaguegamefinder.LeagueGameFinder(
            player_or_team_abbreviation="P",
            season_nullable=selection.season,
            season_type_nullable=selection.season_type,
            league_id_nullable="00",
            timeout=self.timeout,
        )

    def _create_player_game_log(self, player: PlayerRef, selection: SeasonSelection) -> Any:
        _, playergamelog = self._import_endpoints()
        return playergamelog.PlayerGameLog(
            player_id=player.player_id,
            season=selection.season,
            season_type_all_star=selection.season_type,
            timeout=self.timeout,
        )

    def _import_endpoints(self):
        try:
            from nba_api.stats.endpoints import leaguegamefinder, playergamelog
        except ModuleNotFoundError as error:
            raise MissingDependencyError(
                "The nba_api package is required. Install dependencies from requirements.txt first."
            ) from error
        return leaguegamefinder, playergamelog

    @staticmethod
    def _extract_rows(endpoint: Any) -> list[dict[str, Any]]:
        normalized = endpoint.get_normalized_dict()
        for value in normalized.values():
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        raise ValueError("The NBA API response did not contain any tabular rows.")
