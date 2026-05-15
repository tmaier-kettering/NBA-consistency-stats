"""Local browser-based admin UI."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread
from typing import Callable
from urllib.parse import parse_qs
import webbrowser

from nba_consistency_stats.config import DEFAULT_HOST, DEFAULT_PORT, VALID_SEASON_TYPES
from nba_consistency_stats.database import SeasonAlreadyLoadedError
from nba_consistency_stats.exporter import export_game_logs_to_json, export_stats_to_json
from nba_consistency_stats.models import SeasonSelection
from nba_consistency_stats.service import ConsistencyStatsService


@dataclass
class JobState:
    """Mutable UI state shared between the request handler and background worker."""

    is_running: bool = False
    selection_label: str = ""
    status_message: str = "Idle"
    result_message: str = ""
    error_message: str = ""
    season_value: str = ""
    season_type_value: str = VALID_SEASON_TYPES[0]


class AdminUiApp:
    """Tiny local web app for viewing and updating the SQLite database."""

    def __init__(self, service: ConsistencyStatsService) -> None:
        self.service = service
        self.state = JobState()
        self._lock = Lock()

    def run(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, open_browser: bool = True) -> None:
        """Start the local admin UI and optionally open it in a browser."""

        handler = self._build_handler()
        with ThreadingHTTPServer((host, port), handler) as server:
            url = f"http://{host}:{port}"
            print(f"NBA consistency stats admin UI running at {url}")
            print("Press Ctrl+C to stop the server.")
            if open_browser:
                webbrowser.open(url)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print("\nShutting down admin UI...")
                server.shutdown()

    def _build_handler(self):
        app = self

        class AdminUiHandler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                app._handle_get(self)

            def do_POST(self) -> None:  # noqa: N802
                app._handle_post(self)

            def log_message(self, format: str, *args) -> None:  # noqa: A003
                return

        return AdminUiHandler

    def _handle_get(self, handler: BaseHTTPRequestHandler) -> None:
        html = self._render_page()
        body = html.encode("utf-8")
        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", "text/html; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)

    def _handle_post(self, handler: BaseHTTPRequestHandler) -> None:
        if handler.path != "/load-season":
            handler.send_error(HTTPStatus.NOT_FOUND)
            return

        content_length = int(handler.headers.get("Content-Length", "0"))
        payload = handler.rfile.read(content_length).decode("utf-8")
        form = parse_qs(payload)
        season_value = form.get("season", [""])[0]
        season_type_value = form.get("season_type", [""])[0]

        try:
            selection = SeasonSelection.from_user_input(season_value, season_type_value)
        except ValueError as error:
            self._set_state(
                error_message=str(error),
                result_message="",
                season_value=season_value,
                season_type_value=season_type_value,
            )
            self._redirect(handler, "/")
            return

        with self._lock:
            self.state.season_value = selection.season
            self.state.season_type_value = selection.season_type
            if self.state.is_running:
                self.state.error_message = "Another season load is already running."
                self.state.result_message = ""
                self._redirect(handler, "/")
                return
            self.state.is_running = True
            self.state.selection_label = f"{selection.season} ({selection.season_type})"
            self.state.status_message = "Starting background fetch..."
            self.state.result_message = ""
            self.state.error_message = ""

        Thread(target=self._load_selection_in_background, args=(selection,), daemon=True).start()
        self._redirect(handler, "/")

    def _load_selection_in_background(self, selection: SeasonSelection) -> None:
        try:
            report = self.service.load_season(selection, progress_callback=self._update_status)
            summary = (
                f"Loaded {report.selection.season} ({report.selection.season_type}) with "
                f"{report.player_count} players and {report.stat_count} stat summaries."
            )
            if report.failed_player_count:
                summary += f" {report.failed_player_count} player fetches were skipped after retries."
            self._update_status("Exporting stats.json for the website...")
            export_stats_to_json(
                self.service.database.database_path,
                progress_callback=self._update_status,
            )
            self._update_status("Exporting game logs for the website...")
            export_game_logs_to_json(
                self.service.database.database_path,
                progress_callback=self._update_status,
            )
            self._set_state(result_message=summary, error_message="")
        except SeasonAlreadyLoadedError as error:
            self._set_state(error_message=str(error), result_message="")
        except Exception as error:  # pragma: no cover - defensive production path
            self._set_state(error_message=f"Season load failed: {error}", result_message="")
        finally:
            with self._lock:
                self.state.is_running = False
                if self.state.status_message == "Starting background fetch...":
                    self.state.status_message = "Idle"

    def _update_status(self, message: str) -> None:
        with self._lock:
            self.state.status_message = message

    def _set_state(
        self,
        *,
        error_message: str,
        result_message: str,
        season_value: str | None = None,
        season_type_value: str | None = None,
    ) -> None:
        with self._lock:
            self.state.error_message = error_message
            self.state.result_message = result_message
            if season_value is not None:
                self.state.season_value = season_value
            if season_type_value is not None:
                self.state.season_type_value = season_type_value
            if not self.state.is_running:
                self.state.status_message = "Idle"

    def _render_page(self) -> str:
        seasons = self.service.list_loaded_seasons()
        with self._lock:
            state = JobState(
                is_running=self.state.is_running,
                selection_label=self.state.selection_label,
                status_message=self.state.status_message,
                result_message=self.state.result_message,
                error_message=self.state.error_message,
                season_value=self.state.season_value,
                season_type_value=self.state.season_type_value,
            )

        rows_html = "".join(
            (
                "<tr>"
                f"<td>{escape(row.season)}</td>"
                f"<td>{escape(row.season_type)}</td>"
                f"<td>{row.player_count}</td>"
                f"<td>{row.stat_count}</td>"
                f"<td>{row.failed_player_count}</td>"
                f"<td>{escape(row.loaded_at.strftime('%Y-%m-%d %H:%M:%S'))}</td>"
                "</tr>"
            )
            for row in seasons
        ) or '<tr><td colspan="6">No seasons have been loaded yet.</td></tr>'

        season_type_options = "".join(
            f'<option value="{escape(option)}" {"selected" if option == state.season_type_value else ""}>{escape(option)}</option>'
            for option in VALID_SEASON_TYPES
        )

        auto_refresh = '<meta http-equiv="refresh" content="5">' if state.is_running else ""
        disabled_attribute = "disabled" if state.is_running else ""
        status_banner = (
            f"<div class='status running'>Running: {escape(state.selection_label)} — {escape(state.status_message)}</div>"
            if state.is_running
            else f"<div class='status idle'>{escape(state.status_message)}</div>"
        )
        result_banner = (
            f"<div class='status success'>{escape(state.result_message)}</div>" if state.result_message else ""
        )
        error_banner = (
            f"<div class='status error'>{escape(state.error_message)}</div>" if state.error_message else ""
        )

        return f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>NBA Consistency Stats Admin</title>
            {auto_refresh}
            <style>
                body {{ font-family: Arial, sans-serif; margin: 2rem; background: #f7f7f7; color: #111; }}
                main {{ max-width: 980px; margin: 0 auto; }}
                .card {{ background: white; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }}
                h1, h2 {{ margin-top: 0; }}
                form {{ display: flex; gap: 1rem; flex-wrap: wrap; align-items: end; }}
                label {{ display: flex; flex-direction: column; font-weight: 600; gap: 0.35rem; }}
                input, select, button {{ font-size: 1rem; padding: 0.55rem 0.7rem; }}
                button {{ background: #0057b8; color: white; border: none; border-radius: 4px; cursor: pointer; }}
                button:disabled {{ background: #7d8ca3; cursor: progress; }}
                table {{ width: 100%; border-collapse: collapse; }}
                th, td {{ text-align: left; padding: 0.6rem; border-bottom: 1px solid #e3e3e3; }}
                .status {{ padding: 0.85rem 1rem; border-radius: 6px; margin-bottom: 0.75rem; }}
                .running {{ background: #eef4ff; color: #113c7d; }}
                .idle {{ background: #f1f5f9; color: #334155; }}
                .success {{ background: #ecfdf5; color: #166534; }}
                .error {{ background: #fef2f2; color: #b91c1c; }}
                code {{ background: #eef2ff; padding: 0.1rem 0.3rem; border-radius: 4px; }}
            </style>
        </head>
        <body>
            <main>
                <section class="card">
                    <h1>NBA Consistency Stats Admin</h1>
                    <p>Run <code>main.py</code> from PyCharm or the terminal, then manage season loads in the browser window that opens automatically.</p>
                    {status_banner}
                    {result_banner}
                    {error_banner}
                    <form method="post" action="/load-season">
                        <label>
                            Season
                            <input name="season" value="{escape(state.season_value)}" placeholder="2024-25" required {disabled_attribute}>
                        </label>
                        <label>
                            Season type
                            <select name="season_type" {disabled_attribute}>
                                {season_type_options}
                            </select>
                        </label>
                        <button type="submit" {disabled_attribute}>Load season</button>
                    </form>
                    <p>Duplicate loads are blocked before any new API calls are started.</p>
                </section>
                <section class="card">
                    <h2>Database contents</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Season</th>
                                <th>Type</th>
                                <th>Players</th>
                                <th>Stat rows</th>
                                <th>Failed players</th>
                                <th>Loaded at (UTC)</th>
                            </tr>
                        </thead>
                        <tbody>{rows_html}</tbody>
                    </table>
                    <p>The SQLite database is created automatically in <code>data/nba_consistency_stats.sqlite3</code>.</p>
                </section>
            </main>
        </body>
        </html>
        """

    @staticmethod
    def _redirect(handler: BaseHTTPRequestHandler, location: str) -> None:
        handler.send_response(HTTPStatus.SEE_OTHER)
        handler.send_header("Location", location)
        handler.end_headers()

def launch_admin_ui(
    service: ConsistencyStatsService,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    open_browser: bool = True,
) -> None:
    """Convenience wrapper used by the CLI entry point."""

    AdminUiApp(service).run(host=host, port=port, open_browser=open_browser)
