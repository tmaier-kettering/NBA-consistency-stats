# NBA Consistency Stats

NBA Consistency Stats is a small admin tool that fetches NBA player game logs, calculates consistency metrics, and stores the results in SQLite.

## What the tool does

For every player in a selected season and season type, the application calculates:

- average
- standard deviation
- consistency rating (CR = average / standard deviation)

The tool supports both **Regular Season** and **Playoffs** data and blocks duplicate loads before any slow API fetch begins.

## Key improvements over the prototype

- supports any valid NBA season in `YYYY-YY` format
- supports both regular season and playoff loads
- provides a browser-based admin UI that opens when `main.py` is run
- stores results in a normalized SQLite database instead of ad hoc CSV checkpoints
- separates the code into dedicated modules for the CLI, UI, database, API access, and stat calculations
- includes automated tests for the core calculation and persistence logic
- adds validation and clearer error handling around bad season input, duplicate season requests, and API failures

## Running the tool

1. Create and activate a virtual environment.
2. Install the dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Launch the admin UI from PyCharm or the terminal:

   ```bash
   python main.py
   ```

4. Enter a season such as `2024-25`, choose **Regular Season** or **Playoffs**, and click **Load season**.

The app creates its SQLite database at `data/nba_consistency_stats.sqlite3`.

## Direct command-line mode

If you want to load a season without opening the admin UI:

```bash
python main.py --season 2024-25 --season-type Playoffs
```

## Project structure

- `main.py` - application entry point
- `nba_consistency_stats/cli.py` - command-line parsing and startup
- `nba_consistency_stats/gui.py` - local browser admin UI
- `nba_consistency_stats/database.py` - SQLite schema and persistence logic
- `nba_consistency_stats/nba_api_client.py` - NBA API access with retries
- `nba_consistency_stats/statistics.py` - average, standard deviation, and CR calculations
- `nba_consistency_stats/service.py` - season loading workflow
- `tests/` - unit tests for calculations and persistence
- `docs/architecture.md` - high-level design notes

## Database schema

### `season_loads`

Stores one row per loaded season and season type.

### `player_consistency_stats`

Stores one row per player/stat combination with these metrics:

- `average`
- `standard_deviation`
- `consistency_rating`

## Validation

Run the test suite with:

```bash
python -m unittest discover -s tests
```
