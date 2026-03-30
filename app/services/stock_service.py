import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd

from app.core.logger import setup_logger
from app.repositories.stock_repository import (
    get_last_date,
    save_stock_data,
    get_latest_price as _repo_get_latest_price,
)
from app.repositories.trades_repository import (
    get_oldest_trade_date_for_ticker,
    get_all_tickers,
)

logger = setup_logger()


# ─────────────────────────────────────────────
# VALIDATION
# ─────────────────────────────────────────────

def validate_ticker(ticker: str) -> tuple[bool, str]:
    """
    Try to fetch minimal info for `ticker` from yfinance.
    Returns (True, currency) if valid, (False, error_message) if not.
    """
    try:
        info = yf.Ticker(ticker).info
        currency = info.get("currency")
        symbol   = info.get("symbol") or info.get("shortName")
        if not currency and not symbol:
            return False, f"Ticker '{ticker}' not found on Yahoo Finance."
        return True, currency or "USD"
    except Exception as exc:
        logger.error(f"Validation failed for '{ticker}': {exc}")
        return False, f"Could not validate ticker '{ticker}': {exc}"


# ─────────────────────────────────────────────
# EXTERNAL DATA SOURCE
# ─────────────────────────────────────────────

def fetch_stock_data(ticker: str, start_date, end_date):
    """Download OHLCV data. Returns (DataFrame, currency) or None."""
    try:
        data = yf.download(ticker, start=start_date, end=end_date, interval="1d", auto_adjust=False)
        currency = yf.Ticker(ticker).info.get("currency", "USD")
        return (data, currency)
    except Exception:
        logger.exception(f"fetch_stock_data failed for {ticker}")
        return None


# ─────────────────────────────────────────────
# ON-DEMAND BOOTSTRAP
# ─────────────────────────────────────────────

def bootstrap_ticker(ticker: str) -> tuple[bool, str]:
    """
    Validate ticker, then fetch historical data back to the oldest trade date.
    Returns (success, message).
    """
    ticker = ticker.upper()

    valid, info = validate_ticker(ticker)
    if not valid:
        logger.warning(f"bootstrap_ticker: invalid '{ticker}': {info}")
        return False, info

    currency = info  # validate_ticker returns currency on success

    oldest = get_oldest_trade_date_for_ticker(ticker)
    if oldest:
        try:
            start_date = datetime.strptime(oldest[:10], "%Y-%m-%d")
        except ValueError:
            start_date = datetime.today() - timedelta(days=365)
    else:
        start_date = datetime.today() - timedelta(days=365)

    today = datetime.today()

    last_db_date = get_last_date(ticker)
    if last_db_date:
        last_dt = datetime.strptime(last_db_date, "%Y-%m-%d")
        if last_dt.date() >= today.date():
            logger.info(f"bootstrap_ticker: {ticker} already up to date")
            return True, f"'{ticker}' is already up to date."
        fetch_from = last_dt + timedelta(days=1)
    else:
        fetch_from = start_date

    logger.info(f"bootstrap_ticker: fetching {ticker} from {fetch_from.date()}")
    result = fetch_stock_data(ticker, fetch_from, today)

    if result is None:
        msg = f"Could not download data for '{ticker}'."
        logger.warning(msg)
        return False, msg

    data, fetched_currency = result
    currency = fetched_currency or currency

    if data.empty:
        msg = f"No price data found for '{ticker}' — may be delisted or future-dated."
        logger.warning(msg)
        return True, msg

    save_stock_data(ticker, data, currency)
    logger.info(f"bootstrap_ticker: {ticker} saved {len(data)} rows")
    return True, f"'{ticker}' data loaded successfully."


# ─────────────────────────────────────────────
# DAILY UPDATE
# ─────────────────────────────────────────────

def update_ticker(ticker: str):
    """Bring one ticker up to date (only missing days)."""
    try:
        today = datetime.today()
        last_date = get_last_date(ticker)

        if last_date:
            start_date = datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)
        else:
            oldest = get_oldest_trade_date_for_ticker(ticker)
            start_date = datetime.strptime(oldest[:10], "%Y-%m-%d") if oldest else today - timedelta(days=365)

        if start_date.date() >= today.date():
            logger.info(f"update_ticker: {ticker} already up to date", cooldown=3600, key=f"uptodate_{ticker}")
            return

        logger.info(f"update_ticker: fetching {ticker} from {start_date.date()}")
        result = fetch_stock_data(ticker, start_date, today)

        if result is None:
            logger.warning(f"update_ticker: no result for '{ticker}'")
            return

        data, currency = result

        if data.empty:
            logger.info(f"update_ticker: no new rows for {ticker}")
            return

        save_stock_data(ticker, data, currency)
        logger.info(f"update_ticker: {ticker} updated ({len(data)} new rows)")

    except Exception:
        logger.exception(f"update_ticker: error for {ticker}")


def update_all_tickers():
    """Bring every ticker in the transactions table up to date."""
    tickers = get_all_tickers()
    if not tickers:
        logger.info("update_all_tickers: no tickers in DB")
        return
    logger.info(f"update_all_tickers: updating {len(tickers)} ticker(s)")
    for ticker in tickers:
        update_ticker(ticker)
    logger.info("update_all_tickers: done")


def get_latest_price(ticker: str):
    return _repo_get_latest_price(ticker)
