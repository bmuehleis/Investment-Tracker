import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
from db.database import get_connection
from utils.logger import setup_logger

logger = setup_logger()

def get_last_date(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
                       SELECT MAX(date) FROM stock_data WHERE ticker = ?
                       """, (ticker,))
        return cursor.fetchone()[0]

def fetch_stock_data(ticker, start_date, end_date):
    try:
        return yf.download(ticker, start=start_date, end=end_date, interval='1d')
    except Exception as e:
        logger.exception(f"Fetch failed for {ticker}")
        return None

def save_to_db(ticker, data):
    if data.empty:
        return

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    data = data.reset_index()

    data['Date'] = pd.to_datetime(data['Date']).dt.strftime('%Y-%m-%d')

    rows = list(zip(
        [ticker] * len(data),
        data['Date'],
        data['Open'],
        data['High'],
        data['Low'],
        data['Close'],
        data.get('Adj Close', data['Close']),
        data['Volume'].astype(int)
    ))

    with get_connection() as conn:
        conn.executemany("""
            INSERT OR REPLACE INTO stock_data
            (ticker, date, open, high, low, close, adj_close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

def update_ticker(ticker):
    from datetime import datetime, timedelta

    today = datetime.today()

    try:
        last_date = get_last_date(ticker)

        if last_date:
            start_date = datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)
        else:
            start_date = today - timedelta(days=365)

        if start_date >= today:
            logger.info(f"{ticker} already up to date")
            return

        logger.info(f"Fetching {ticker}...")

        data = fetch_stock_data(ticker, start_date, today)

        if data is None or data.empty:
            logger.warning(f"No data found for ticker '{ticker}' (invalid or delisted)")
            return

        save_to_db(ticker, data)

        logger.info(f"{ticker} updated successfully")

    except Exception as e:
        logger.exception(f"Error updating {ticker}")

def get_latest_price(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
                       SELECT adj_close
                       FROM stock_data
                       WHERE ticker = ?
                       ORDER BY date DESC
                       LIMIT 1
                       """, (ticker,))
        
        result = cursor.fetchone()
    return result[0] if result else None