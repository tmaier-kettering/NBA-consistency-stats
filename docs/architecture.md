# Architecture Overview

## Application flow

1. `main.py` starts the CLI.
2. The CLI creates the database and service objects.
3. Running without `--season` launches a local browser-based admin UI.
4. Submitting the form starts a background season load.
5. The service layer checks for duplicate seasons before calling the NBA API.
6. Player game logs are summarized into average, standard deviation, and CR values.
7. The SQLite database stores the completed season so the admin UI can display it on the next refresh.

## Design choices

- **SQLite** keeps the tool easy to run locally from PyCharm with no server setup.
- **Normalized stat rows** make it easy to query any stat or add new derived metrics later.
- **Background UI jobs** keep the admin page responsive while a season fetch is running.
- **Central validation** in the `SeasonSelection` model keeps season rules consistent across the UI and CLI.
- **Retry logic** is isolated in the NBA API client so network handling is easy to test and maintain.
