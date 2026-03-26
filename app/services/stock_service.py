import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd

from app.core.logger import setup_logger
from app.repositories.stock_repository import (
    get_last_date,
    save_stock_data,
    get_latest_price
)

logger = setup_logger()


# -------------------------
# EXTERNAL DATA SOURCE
# -------------------------
def fetch_stock_data(ticker, start_date, end_date):
    try:
        data = yf.download(ticker, start=start_date, end=end_date, interval='1d')
        currency = yf.Ticker(ticker).info.get('currency', 'UNKNOWN')
        return (data, currency)
    except Exception:
        logger.exception(f"Fetch failed for {ticker}")
        return None


# -------------------------
# ORCHESTRATION
# -------------------------
def update_ticker(ticker):
    try:
        today = datetime.today()

        last_date = get_last_date(ticker)

        if last_date:
            start_date = datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)
        else:
            start_date = today - timedelta(days=365)

        if start_date >= today:
            logger.info(f"{ticker} already up to date")
            return

        logger.info(f"Fetching {ticker}...")

        result = fetch_stock_data(ticker, start_date, today)

        if result is None:
            logger.warning(f"No data found for ticker '{ticker}' (invalid or delisted)")
            return

        data, currency = result

        if data.empty:
            logger.warning(f"No data found for ticker '{ticker}' (invalid or delisted)")
            return

        save_stock_data(ticker, data, currency)

        logger.info(f"{ticker} updated successfully")

    except Exception:
        logger.exception(f"Error updating {ticker}")