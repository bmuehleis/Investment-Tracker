# app/services/pnl_service.py

from app.core.logger import setup_logger
from app.services.stock_service import get_latest_price
from app.repositories.trades_repository import get_trades_by_ticker, get_all_tickers

logger = setup_logger()


def calculate_fifo_pnl(ticker: str):
    if not isinstance(ticker, str):
        raise TypeError(f"ticker must be str, got {type(ticker)}: {ticker}")

    trades = get_trades_by_ticker(ticker)

    buy_queue = []
    realized_pnl = 0.0

    for trade in trades:
        action = trade["action"]
        quantity = float(trade["quantity"])

        #TODO: ADD CURRENCY CONVERSION LATER
        price = trade["price"]
        commission = trade["commission"]

        if action == "BUY":
            buy_queue.append({
                "shares": quantity,
                "price": price,
                "commission": commission
            })

        elif action == "SELL":
            remaining = quantity

            while remaining > 0 and buy_queue:
                lot = buy_queue[0]

                used = min(lot["shares"], remaining)

                buy_commission = (lot["commission"] / lot["shares"]) * used if lot["shares"] > 0 else 0
                sell_commission = commission * (used / quantity) if quantity > 0 else 0

                cost_basis = used * lot["price"] + buy_commission
                sell_value = used * price - sell_commission

                realized_pnl += (sell_value - cost_basis)

                lot["shares"] -= used
                remaining -= used

                if lot["shares"] <= 0:
                    buy_queue.pop(0)

            if remaining > 0:
                logger.warning(f"{ticker}: SELL exceeds available shares")

    remaining_shares = sum(lot["shares"] for lot in buy_queue)

    return {
        "remaining_shares": remaining_shares,
        "buy_queue": buy_queue,
        "realized_pnl": realized_pnl
    }


def calculate_unrealized_pnl(ticker: str):
    data = calculate_fifo_pnl(ticker)
    current_price = get_latest_price(ticker)

    if current_price is None:
        return 0.0

    current_price = float(current_price)

    return sum(
        (current_price - lot["price"]) * lot["shares"]
        for lot in data["buy_queue"]
    )


def calculate_total_unrealized_pnl():
    return sum(
        calculate_unrealized_pnl(ticker)
        for ticker in get_all_tickers()
    )


def calculate_total_realized_pnl():
    return sum(
        calculate_fifo_pnl(ticker)["realized_pnl"]
        for ticker in get_all_tickers()
    )


def calculate_average_price(ticker: str):
    data = calculate_fifo_pnl(ticker)

    total_shares = data["remaining_shares"]
    if total_shares == 0:
        return 0.0

    total_cost = sum(
        lot["shares"] * lot["price"]
        for lot in data["buy_queue"]
    )

    return total_cost / total_shares