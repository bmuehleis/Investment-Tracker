from db.database import get_connection
from utils.logger import setup_logger
from services.stock import get_latest_price
from services.portfolio import get_all_tickers

logger = setup_logger()


# =========================
# DATA ACCESS
# =========================
def get_trades(ticker):
    try:
        logger.info(f"Fetching trades for {ticker}")

        with get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT date, action, quantity, price, commission, currency
                FROM transactions
                WHERE ticker = ?
                ORDER BY date ASC
            """, (ticker,))

            rows = cursor.fetchall()

        cleaned_trades = []
        for row in rows:
            date, action, quantity, price, commission, currency = row

            cleaned_trades.append({
                "date": date,
                "action": str(action).upper(),  # normalize
                "quantity": float(quantity),
                "price": float(price),
                "commission": float(commission) if commission is not None else 0.0,
                "currency": currency
            })

        logger.debug(f"Retrieved {len(cleaned_trades)} trades for {ticker}")
        return cleaned_trades

    except Exception as e:
        logger.exception(f"Error fetching trades for {ticker}: {e}")
        return []


# =========================
# CURRENCY (PLACEHOLDER)
# =========================
def convert_to_base_currency(amount, currency, base_currency='EUR'):
    try:
        return float(amount)
    except Exception as e:
        logger.exception(f"Error converting currency: {e}")
        return 0.0


# =========================
# FIFO CORE ENGINE
# =========================
def calculate_fifo_pnl(ticker):
    trades = get_trades(ticker)

    buy_queue = []
    realized_pnl = 0.0

    try:
        for trade in trades:
            action = trade["action"]
            quantity = trade["quantity"]
            price = convert_to_base_currency(trade["price"], trade["currency"])
            commission = convert_to_base_currency(trade["commission"], trade["currency"])

            if action == 'BUY':
                buy_queue.append({
                    "shares": quantity,
                    "price": price,
                    "commission": commission
                })

            elif action == 'SELL':
                remaining = quantity

                while remaining > 0 and buy_queue:
                    lot = buy_queue[0]

                    used = min(lot["shares"], remaining)

                    # proportional commissions
                    buy_commission = (lot["commission"] / lot["shares"]) * used if lot["shares"] > 0 else 0
                    sell_commission = commission * (used / quantity) if quantity > 0 else 0

                    cost_basis = used * lot["price"] + buy_commission
                    sell_value = used * price - sell_commission

                    pnl = sell_value - cost_basis
                    realized_pnl += pnl

                    lot["shares"] -= used
                    remaining -= used

                    if lot["shares"] == 0:
                        buy_queue.pop(0)

                if remaining > 0:
                    logger.warning(f"{ticker}: SELL exceeds available shares")

        remaining_shares = sum(lot["shares"] for lot in buy_queue)

        logger.info(
            f"{ticker} FIFO result realized={realized_pnl:.2f}, remaining={remaining_shares}"
        )

        return {
            "remaining_shares": remaining_shares,
            "buy_queue": buy_queue,
            "realized_pnl": realized_pnl
        }

    except Exception as e:
        logger.exception(f"Error calculating FIFO P&L for {ticker}: {e}")
        return {
            "remaining_shares": 0,
            "buy_queue": [],
            "realized_pnl": 0.0
        }


# =========================
# AVERAGE PRICE
# =========================
def calculate_average_price(ticker):
    data = calculate_fifo_pnl(ticker)
    total_shares = data["remaining_shares"]

    if total_shares == 0:
        return 0.0

    total_cost = sum(
        lot["shares"] * lot["price"]
        for lot in data["buy_queue"]
    )

    avg_price = total_cost / total_shares
    return avg_price


# =========================
# UNREALIZED P&L
# =========================
def calculate_unrealized_pnl(ticker):
    try:
        data = calculate_fifo_pnl(ticker)
        current_price = get_latest_price(ticker)

        if current_price is None:
            logger.warning(f"No price data for {ticker}")
            return 0.0

        current_price = float(current_price)

        unrealized = 0.0

        for lot in data["buy_queue"]:
            pnl = (current_price - lot["price"]) * lot["shares"]
            unrealized += pnl

        return unrealized

    except Exception as e:
        logger.exception(f"Error calculating unrealized P&L for {ticker}: {e}")
        return 0.0


# =========================
# PORTFOLIO TOTALS
# =========================
def calculate_total_unrealized_pnl():
    total = 0.0

    for ticker in get_all_tickers():
        total += calculate_unrealized_pnl(ticker)

    logger.info(f"Total unrealized P&L: {total:.2f}")
    return total


def calculate_total_realized_pnl():
    total = 0.0

    for ticker in get_all_tickers():
        data = calculate_fifo_pnl(ticker)
        total += data["realized_pnl"]

    logger.info(f"Total realized P&L: {total:.2f}")
    return total
