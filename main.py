from config import TICKERS
import uvicorn
from db.database import create_tables
from services.portfolio import (
    log_trade, 
    calculate_holdings, 
    calculate_portfolio_value
    )
from services.pnl_calc import (
    calculate_unrealized_pnl,
    calculate_total_unrealized_pnl,
    calculate_total_realized_pnl,
    calculate_average_price
)
from services.stock import update_ticker
from utils.logger import setup_logger

logger = setup_logger()

def run_trade_test():
    logger.info("Inserting test trades...")
    
    test_trades = [
        ("AAPL", "2024-01-10", "BUY", 10, 150.0, 1.0, 'USD', "first buy"),
        ("AAPL", "2024-03-15", "BUY", 5, 170.0, 1.0, 'USD', "dip buy"),
        ("AAPL", "2024-06-01", "SELL", 3, 180.0, 1.0, 'USD', "partial take profit"),
        ("MSFT", "2024-02-01", "BUY", 8, 300.0, 1.0, 'USD', "entry"),
        ("MSFT", "2024-05-01", "BUY", 4, 320.0, 1.0, 'USD', "add position"),
    ]

    for t in test_trades:
        log_trade(*t)

    logger.info("Trade test complete")


def main():
    create_tables()
    
    for ticker in TICKERS:
        update_ticker(ticker)
    
    run_trade_test()
    
    holdings = calculate_holdings()
    total_value = calculate_portfolio_value()
    print(f"HOLDINGS: {holdings}")
    print(f"PORTFOLIO VALUE: {total_value:.2f} EUR")
    print(f"AAPL Avg Price: {calculate_average_price('AAPL'):.2f}")
    print(f"AAPL Unrealized: {calculate_unrealized_pnl('AAPL'):.2f}")
    print(f"Total Unrealized: {calculate_total_unrealized_pnl():.2f}")
    print(f"Total Realized: {calculate_total_realized_pnl():.2f}")


if __name__ == "__main__":
    uvicorn.run("api.api:app", host="127.0.0.1", port=8000, reload=True)
