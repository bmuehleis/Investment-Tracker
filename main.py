"""
main.py
Entry point for the Investment Tracker.
On startup:
  - Creates DB tables if they don't exist.
  - Runs an initial update of all tickers already in the DB.
Background thread:
  - Checks once per minute whether today's data is already present.
  - If not, fetches fresh quotes for every ticker in the transactions table.
  - This handles the daily "today is missing" case automatically and also
    reacts correctly to trade additions, edits, and deletions (the ticker
    list is re-read from the DB on every iteration).
"""

import time
import threading
from datetime import date

import uvicorn

from app.core.logger import setup_logger
from app.core.database import create_tables
from app.repositories.stock_repository import get_last_date
from app.repositories.trades_repository import get_all_tickers
from app.services.stock_service import update_all_tickers

logger = setup_logger()

# ─────────────────────────────────────────────
# DAILY FRESHNESS CHECK
# ─────────────────────────────────────────────

def _is_today_present() -> bool:
    """
    Return True only if every ticker that has trades already has a
    stock_data row for today (or the most recent trading day matches today).
    We use a lighter heuristic: check the global MAX(date) across all tickers.
    """
    today_str = date.today().isoformat()
    tickers = get_all_tickers()
    if not tickers:
        return True  # nothing to update

    for ticker in tickers:
        last = get_last_date(ticker)
        if last is None or last < today_str:
            return False
    return True


def _daily_update_loop():
    """
    Background daemon thread.
    Polls every 60 seconds; triggers a full update when today's data is missing.
    """
    logger.info("Daily update thread started.")
    while True:
        try:
            if not _is_today_present():
                logger.info("Daily update: today's data missing — running update_all_tickers()")
                update_all_tickers()
            else:
                logger.info("Daily update: all tickers up to date.", cooldown=36000, key="daily_ok") #cooldown=3600 i moved this to 10h for now
        except Exception:
            logger.exception("Daily update thread encountered an error.")
        time.sleep(60)


# ─────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────

def bootstrap():
    logger.info("Bootstrap: initial ticker sync …")
    update_all_tickers()
    logger.info("Bootstrap: done.")


if __name__ == "__main__":
    create_tables()
    bootstrap()

    # Start background daily-update thread (daemon so it dies with the process)
    t = threading.Thread(target=_daily_update_loop, daemon=True, name="daily-update")
    t.start()

    uvicorn.run(
        "app.api.api:app",
        host="127.0.0.1",
        port=8000,
        reload=False,  # reload=True would kill the background thread on each reload
    )
