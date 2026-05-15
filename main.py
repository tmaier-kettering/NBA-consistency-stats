import pandas as pd
from nba_api.stats.endpoints import leaguegamefinder

season = "2025-26"

games = leaguegamefinder.LeagueGameFinder(
    player_or_team_abbreviation="P",
    season_nullable=season,
    season_type_nullable="Regular Season",
    league_id_nullable="00"
).get_data_frames()[0]

players_last_season_unique = (
    games[
        ["PLAYER_ID", "PLAYER_NAME"]
    ]
    .drop_duplicates()
    .sort_values("PLAYER_NAME")
    .reset_index(drop=True)
)

from nba_api.stats.endpoints import playergamelog

first_player_id = int(players_last_season_unique.loc[68, "PLAYER_ID"])
first_player_name = players_last_season_unique.loc[68, "PLAYER_NAME"]

log = playergamelog.PlayerGameLog(
    player_id=first_player_id,
    season="2024-25",
    season_type_all_star="Regular Season"
).get_data_frames()[0]

import time
import random
import pandas as pd
from requests.exceptions import ReadTimeout, RequestException
from nba_api.stats.endpoints import playergamelog

season = "2024-25"
checkpoint_file = "player_stats_checkpoint.csv"
failures_file = "player_stats_failures.csv"

def fetch_player_log(player_id, season="2024-25", max_retries=5, timeout=60):
    """
    Fetch one player's game log with retries and backoff.
    """
    for attempt in range(1, max_retries + 1):
        try:
            log = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season,
                season_type_all_star="Regular Season",
                timeout=timeout
            ).get_data_frames()[0]
            return log

        except (ReadTimeout, RequestException, Exception) as e:
            print(f"Attempt {attempt}/{max_retries} failed for player_id={player_id}: {e}")

            if attempt == max_retries:
                raise

            sleep_time = (2 ** attempt) + random.uniform(0, 1)
            print(f"Retrying in {sleep_time:.1f} seconds...")
            time.sleep(sleep_time)

results = []
failures = []

for i, row in enumerate(players_last_season_unique.head(5).itertuples(index=False), start=1):
    player_id = int(row.PLAYER_ID)
    player_name = row.PLAYER_NAME

    print(f"[{i}/{len(players_last_season_unique)}] {player_name} ({player_id})")

    try:
        log = fetch_player_log(player_id, season=season, max_retries=5, timeout=60)

        # Identify numeric columns
        numeric_cols = log.select_dtypes(include="number").columns.tolist()

        # Exclude Player_ID and Video Available
        numeric_cols = [col for col in numeric_cols if col != "Player_ID" and col != "VIDEO_AVAILABLE"]

        player_result = {
            "PLAYER_ID": player_id,
            "PLAYER_NAME": player_name,
            "GAMES_PLAYED": len(log)
        }

        for col in numeric_cols:
            avg_val = log[col].mean()
            std_val = log[col].std()

            player_result[f"{col}_AVG"] = avg_val
            player_result[f"{col}_STD"] = std_val

            if pd.isna(avg_val) or avg_val == 0:
                player_result[f"{col}_CR"] = None
            else:
                player_result[f"{col}_CR"] = avg_val / std_val

        results.append(player_result)

    except Exception as e:
        print(f"Skipping {player_name}: {e}")
        failures.append({
            "PLAYER_ID": player_id,
            "PLAYER_NAME": player_name,
            "ERROR": str(e)
        })

    # Small delay to be polite to the API
    time.sleep(0.3 + random.uniform(0, 0.4))

    # Save checkpoint every 10 players
    if i % 10 == 0:
        checkpoint_df = pd.DataFrame(results).round(2)
        checkpoint_df.to_csv(checkpoint_file, index=False)

        failures_df = pd.DataFrame(failures)
        failures_df.to_csv(failures_file, index=False)

        print(f"Checkpoint saved after {i} players.")

# Final save
test_summary = pd.DataFrame(results).round(2)
test_summary.to_csv(checkpoint_file, index=False)

failures_df = pd.DataFrame(failures)
failures_df.to_csv(failures_file, index=False)

test_summary
