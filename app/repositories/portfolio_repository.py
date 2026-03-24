import pandas as pd
from app.core.database import get_connection
from app.core.logger import setup_logger

logger = setup_logger()


# -------------------------
# READ
# -------------------------
def get_last_date(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT MAX(date)
            FROM stock_data
            WHERE ticker = ?
        """, (ticker,))
        return cursor.fetchone()[0]


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

    return float(result[0]) if result else None

def get_ticker_holdings(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT action, quantity
            FROM transactions
            WHERE ticker = ?
        """, (ticker,))

        rows = cursor.fetchall()

    holdings = 0.0
    for action, quantity in rows:
        if action.upper() == "BUY":
            holdings += float(quantity)
        elif action.upper() == "SELL":
            holdings -= float(quantity)

    return holdings

# -------------------------
# WRITE
# -------------------------
def save_stock_data(ticker, data):
    if data.empty:
        return

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    data = data.reset_index()
    data["Date"] = pd.to_datetime(data["Date"]).dt.strftime("%Y-%m-%d")

    rows = list(zip(
        [ticker] * len(data),
        data["Date"],
        data["Open"],
        data["High"],
        data["Low"],
        data["Close"],
        data.get("Adj Close", data["Close"]),
        data["Volume"].astype(int)
    ))

    with get_connection() as conn:
        conn.executemany("""
            INSERT OR REPLACE INTO stock_data
            (ticker, date, open, high, low, close, adj_close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)