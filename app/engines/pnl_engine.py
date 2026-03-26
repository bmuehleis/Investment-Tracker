# app/services/pnl_service.py

from app.core.logger import setup_logger
from app.services.stock_service import get_latest_price
from app.repositories.trades_repository import get_trades_by_ticker, get_all_tickers
from app.utils.currency import convert_if_needed

logger = setup_logger()


def calculate_fifo_pnl(ticker: str, base_currency: str = "EUR", rate_date: str = None):
    if not isinstance(ticker, str):
        raise TypeError(f"ticker must be str, got {type(ticker)}: {ticker}")

    trades = get_trades_by_ticker(ticker)

    buy_queue = []
    realized_pnl = 0.0

    for trade in trades:
        action = trade["action"]
        quantity = float(trade["quantity"])
        trade_currency = trade.get("currency", "EUR")

        # Convert price and commission to base currency if needed
        price = convert_if_needed(
            float(trade["price"]),
            trade_currency,
            base_currency,
            rate_date=rate_date
        )
        commission = convert_if_needed(
            float(trade["commission"]),
            trade_currency,
            base_currency,
            rate_date=rate_date
        )

        if action == "BUY":
            buy_queue.append({
                "shares": quantity,
                "price": price,
                "commission": commission,
                "original_currency": trade_currency
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


def calculate_unrealized_pnl(ticker: str, base_currency: str = "EUR"):
    data = calculate_fifo_pnl(ticker, base_currency)
    current_price = get_latest_price(ticker)

    if current_price is None:
        return 0.0

    current_price = float(current_price)

    # Convert current price to base currency if needed
    stock_currency = "USD"  # yfinance prices are in stock's native currency
    current_price = convert_if_needed(current_price, stock_currency, base_currency)

    return sum(
        (current_price - lot["price"]) * lot["shares"]
        for lot in data["buy_queue"]
    )


def calculate_total_unrealized_pnl(base_currency: str = "EUR"):
    return sum(
        calculate_unrealized_pnl(ticker, base_currency)
        for ticker in get_all_tickers()
    )


def calculate_total_realized_pnl(base_currency: str = "EUR"):
    return sum(
        calculate_fifo_pnl(ticker, base_currency)["realized_pnl"]
        for ticker in get_all_tickers()
    )


def calculate_average_price(ticker: str, base_currency: str = "EUR"):
    data = calculate_fifo_pnl(ticker, base_currency)

    total_shares = data["remaining_shares"]
    if total_shares == 0:
        return 0.0

    total_cost = sum(
        lot["shares"] * lot["price"]
        for lot in data["buy_queue"]
    )

    return total_cost / total_shares