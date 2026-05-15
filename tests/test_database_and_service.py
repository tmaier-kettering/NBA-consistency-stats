import tempfile
import unittest
from pathlib import Path

from nba_consistency_stats.database import ConsistencyDatabase, SeasonAlreadyLoadedError
from nba_consistency_stats.models import PlayerRef, SeasonSelection
from nba_consistency_stats.service import ConsistencyStatsService


class FakeClient:
    def __init__(self):
        self.list_calls = []
        self.log_calls = []

    def list_players_for_season(self, selection):
        self.list_calls.append(selection.key)
        return [
            PlayerRef(player_id=1, player_name="Alice Scorer"),
            PlayerRef(player_id=2, player_name="Bob Rebounder"),
        ]

    def fetch_player_game_log(self, player, selection):
        self.log_calls.append((player.player_id, selection.key))
        if player.player_id == 2:
            raise RuntimeError("temporary timeout")
        return [
            {"PLAYER_ID": player.player_id, "PTS": 10, "MIN": 25, "VIDEO_AVAILABLE": 1},
            {"PLAYER_ID": player.player_id, "PTS": 14, "MIN": 27, "VIDEO_AVAILABLE": 1},
        ]


class DatabaseAndServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "stats.sqlite3"
        self.database = ConsistencyDatabase(self.database_path)
        self.service = ConsistencyStatsService(database=self.database, client=FakeClient())

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_load_season_saves_only_successful_players_and_tracks_failures(self):
        selection = SeasonSelection.from_user_input("2024-25", "Playoffs")
        progress_messages = []

        report = self.service.load_season(selection, progress_callback=progress_messages.append)
        seasons = self.database.list_loaded_seasons()

        self.assertEqual(report.player_count, 1)
        self.assertEqual(report.failed_player_count, 1)
        self.assertEqual(seasons[0].season, "2024-25")
        self.assertEqual(seasons[0].season_type, "Playoffs")
        self.assertEqual(seasons[0].failed_player_count, 1)
        self.assertTrue(any("Finding players" in message for message in progress_messages))

    def test_duplicate_season_is_blocked_before_fetching(self):
        selection = SeasonSelection.from_user_input("2024-25", "Regular Season")
        self.service.load_season(selection)
        initial_list_calls = len(self.service.client.list_calls)

        with self.assertRaises(SeasonAlreadyLoadedError):
            self.service.load_season(selection)

        self.assertEqual(len(self.service.client.list_calls), initial_list_calls)


if __name__ == "__main__":
    unittest.main()
