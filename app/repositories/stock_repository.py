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

def get_price_on_or_before(ticker: str, day_str: str) -> tuple[float | None, str | None]:
    try:
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT adj_close, currency
                FROM stock_data
                WHERE ticker = ? AND date <= ?
                ORDER BY date DESC
                LIMIT 1
                """,
                (ticker, day_str),
            ).fetchone()
            if row:
                return float(row[0]), row[1]
            return None, None
    except Exception as e:
        logger.exception(f"Error fetching price for {ticker} on or before {day_str}: {e}")
        return None, None

def get_currency_at_date(ticker, date):
    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT currency
            FROM stock_data
            WHERE ticker = ? AND date = ?
        """, (ticker, date))

        result = cursor.fetchone()

    return result[0] if result else None

def get_latest_currency(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT currency
            FROM stock_data
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT 1
        """, (ticker,))

        result = cursor.fetchone()

    return result[0] if result else None

# -------------------------
# WRITE
# -------------------------
def save_stock_data(ticker, data, currency):
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
        data["Volume"].astype(int),
        [currency] * len(data)
    ))

    with get_connection() as conn:
        conn.executemany("""
            INSERT OR REPLACE INTO stock_data
            (ticker, date, open, high, low, close, adj_close, volume, currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)