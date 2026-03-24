from app.core.logger import setup_logger
from app.repositories.portfolio_repository import get_holdings
from app.services.stock_service import get_latest_price
from app.engines.pnl_engine import calculate_portfolio_value

logger = setup_logger()


def calculate_portfolio_value_service():
    try:
        holdings = get_holdings()

        return calculate_portfolio_value(
            holdings,
            get_latest_price
        )

    except Exception:
        logger.exception("Error calculating portfolio value")
        return 0.0