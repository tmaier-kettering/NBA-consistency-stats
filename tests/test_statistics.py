import unittest

from nba_consistency_stats.models import PlayerRef
from nba_consistency_stats.statistics import build_player_summary, calculate_consistency_metrics


class StatisticsTests(unittest.TestCase):
    def test_calculate_consistency_metrics_returns_none_for_zero_standard_deviation(self):
        average, standard_deviation, consistency_rating = calculate_consistency_metrics([12, 12, 12])

        self.assertEqual(average, 12.0)
        self.assertEqual(standard_deviation, 0.0)
        self.assertIsNone(consistency_rating)

    def test_build_player_summary_includes_numeric_box_score_fields(self):
        player = PlayerRef(player_id=7, player_name="Tester")
        rows = [
            {"PLAYER_ID": 7, "PTS": 10, "MIN": 20.5, "MATCHUP": "A vs B", "VIDEO_AVAILABLE": 1},
            {"PLAYER_ID": 7, "PTS": 14, "MIN": 26.5, "MATCHUP": "A @ B", "VIDEO_AVAILABLE": 1},
        ]

        summary = build_player_summary(player, rows)
        stats_by_name = {stat.stat_name: stat for stat in summary.statistics}

        self.assertEqual(summary.games_played, 2)
        self.assertIn("PTS", stats_by_name)
        self.assertIn("MIN", stats_by_name)
        self.assertNotIn("MATCHUP", stats_by_name)
        self.assertNotIn("VIDEO_AVAILABLE", stats_by_name)
        self.assertEqual(stats_by_name["PTS"].average, 12.0)
        self.assertEqual(stats_by_name["MIN"].average, 23.5)


if __name__ == "__main__":
    unittest.main()
