from app.core.database import get_connection
from app.core.logger import setup_logger
import sqlite3

logger = setup_logger()


# -------------------------
# CREATE
# -------------------------
def log_trade(**trade):
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO transactions
            (ticker, date, action, quantity, price, commission, currency, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            trade["ticker"],
            trade["date"],
            trade["action"].upper(),
            trade["quantity"],
            trade["price"],
            trade.get("commission", 0),
            trade.get("currency", "EUR"),
            trade.get("note")
        ))

    logger.info(
        f"Trade logged: {trade['action']} {trade['quantity']} {trade['ticker']} @ {trade['price']}"
    )


# -------------------------
# DELETE
# -------------------------
def delete_trade(trade_id):
    try:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM transactions WHERE id = ?",
                (trade_id,)
            )
            conn.commit()

        logger.info(f"Trade with ID {trade_id} deleted successfully.")

    except Exception as e:
        logger.error(f"Error deleting trade with ID {trade_id}: {e}")


def delete_all_trades():
    try:
        with get_connection() as conn:
            conn.execute("DELETE FROM transactions")
            conn.commit()

        logger.info("All trades deleted successfully.")

    except Exception as e:
        logger.error(f"Error deleting all trades: {e}")


# -------------------------
# UPDATE
# -------------------------
def edit_trade(trade_id, **fields):
    try:
        allowed_fields = {
            "date", "action", "quantity", "price",
            "commission", "currency", "note"
        }

        updates = []
        values = []

        for key, value in fields.items():
            if key in allowed_fields:
                updates.append(f"{key} = ?")
                values.append(value)

        if not updates:
            logger.warning(f"No valid fields provided for update (trade_id={trade_id})")
            return

        values.append(trade_id)

        query = f"""
            UPDATE transactions
            SET {', '.join(updates)}
            WHERE id = ?
        """

        with get_connection() as conn:
            conn.execute(query, values)
            conn.commit()

        logger.info(f"Trade with ID {trade_id} updated successfully.")

    except Exception as e:
        logger.error(f"Error updating trade with ID {trade_id}: {e}")


# -------------------------
# READ
# -------------------------
def get_trades_by_ticker(ticker):
    try:
        with get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT date, action, quantity, price, commission, currency
                FROM transactions
                WHERE ticker = ?
                ORDER BY date ASC
            """, (ticker,))

            rows = cursor.fetchall()

        return [
            {
                "date": date,
                "action": action.upper(),
                "quantity": float(quantity),
                "price": float(price),
                "commission": float(commission or 0),
                "currency": currency
            }
            for date, action, quantity, price, commission, currency in rows
        ]

    except Exception as e:
        logger.exception(f"Error fetching trades for {ticker}: {e}")
        return []


def get_all_trades():
    try:
        with get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute("SELECT * FROM transactions ORDER BY date DESC")
            rows = cursor.fetchall()

            return [dict(row) for row in rows]

    except Exception as e:
        logger.error(f"Error fetching all trades: {e}")
        return []


def get_all_tickers():
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT ticker FROM transactions")
            return [row[0] for row in cursor.fetchall()]

    except Exception as e:
        logger.error(f"Error fetching all tickers: {e}")
        return []