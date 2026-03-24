from app.core.logger import setup_logger
from app.repositories.trades_repository import get_trades_by_ticker, get_all_tickers
from app.engines.pnl_engine import calculate_fifo_pnl
from app.services.stock_service import get_latest_price

logger = setup_logger()


def calculate_unrealized_pnl(ticker: str):
    try:
        data = calculate_fifo_pnl(ticker)

        current_price = get_latest_price(ticker)
        if current_price is None:
            logger.warning(f"No price data for {ticker}")
            return 0.0

        unrealized = 0.0
        for lot in data["buy_queue"]:
            unrealized += (current_price - lot["price"]) * lot["shares"]

        return unrealized

    except Exception:
        logger.exception(f"Error calculating unrealized P&L for {ticker}")
        return 0.0


def calculate_total_unrealized_pnl():
    total = 0.0

    for ticker in get_all_tickers():
        total += calculate_unrealized_pnl(ticker)

    return total


def calculate_total_realized_pnl():
    total = 0.0

    for ticker in get_all_tickers():
        result = calculate_fifo_pnl(ticker)
        total += result["realized_pnl"]

    return total