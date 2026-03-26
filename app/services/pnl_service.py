from app.core.logger import setup_logger
from app.repositories.trades_repository import get_trades_by_ticker, get_all_tickers
from app.repositories.stock_repository import get_latest_currency
from app.engines.pnl_engine import calculate_fifo_pnl
from app.services.stock_service import get_latest_price
from app.utils.currency import convert_if_needed

logger = setup_logger()


def calculate_unrealized_pnl(ticker: str, base_currency: str = "EUR"):
    try:
        data = calculate_fifo_pnl(ticker, base_currency)

        current_price = get_latest_price(ticker)
        if current_price is None:
            logger.warning(f"No price data for {ticker}")
            return 0.0

        # Convert current price to base currency using the stored stock currency
        stock_currency = get_latest_currency(ticker) or "USD"
        current_price = convert_if_needed(current_price, stock_currency, base_currency)

        unrealized = 0.0
        for lot in data["buy_queue"]:
            unrealized += (current_price - lot["price"]) * lot["shares"]

        return unrealized

    except Exception:
        logger.exception(f"Error calculating unrealized P&L for {ticker}")
        return 0.0


def calculate_total_unrealized_pnl(base_currency: str = "EUR"):
    total = 0.0

    for ticker in get_all_tickers():
        total += calculate_unrealized_pnl(ticker, base_currency)

    return total


def calculate_total_realized_pnl(base_currency: str = "EUR"):
    total = 0.0

    for ticker in get_all_tickers():
        result = calculate_fifo_pnl(ticker, base_currency)
        total += result["realized_pnl"]

    return total