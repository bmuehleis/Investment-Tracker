import uvicorn

from app.core.config import TICKERS
from app.core.logger import setup_logger
from app.core.database import create_tables

from app.services.stock_service import update_ticker

logger = setup_logger()


def bootstrap_data():
    logger.info("Starting initial data sync...")

    for ticker in TICKERS:
        update_ticker(ticker)

    logger.info("Initial sync completed.")


if __name__ == "__main__":
    create_tables()
    bootstrap_data()

    uvicorn.run(
        "app.api.api:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )