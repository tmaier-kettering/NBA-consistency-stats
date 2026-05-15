"""Application configuration helpers."""

from __future__ import annotations

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_ROOT.parent
DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_DATABASE_PATH = DATA_DIR / "nba_consistency_stats.sqlite3"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
VALID_SEASON_TYPES = ("Regular Season", "Playoffs")
