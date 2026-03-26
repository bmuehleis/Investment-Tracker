import uvicorn
from app.core.config import TICKERS
from app.core.logger import setup_logger
from app.core.database import create_tables
from app.services.stock_service import update_ticker
from app.utils.currency import convert_currency_api

logger = setup_logger()


def bootstrap_data():
    logger.info("Starting initial data sync...")

    for ticker in TICKERS:
        update_ticker(ticker)

    logger.info("Initial sync completed.")


if __name__ == "__main__":
    create_tables()
    bootstrap_data()
    
    print(convert_currency_api(100, 'USD', 'EUR'))
    print(convert_currency_api(100, 'EUR', 'GBP'))

    uvicorn.run(
        "app.api.api:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
