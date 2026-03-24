from config import TICKERS
from db.database import create_tables
from services.portfolio import (
    log_trade, 
    calculate_holdings, 
    calculate_portfolio_value,
    calculate_total_unrealized_pnl,
    calculate_total_realized_pnl
    )
from services.stock import update_ticker
from utils.logger import setup_logger

logger = setup_logger()

def run_trade_test():
    logger.info("Inserting test trades...")
    
    test_trades = [
        ("AAPL", "2024-01-10", "BUY", 10, 150.0, 'USD', 1.0, "first buy"),
        ("AAPL", "2024-03-15", "BUY", 5, 170.0, 'USD', 1.0, "dip buy"),
        ("AAPL", "2024-06-01", "SELL", 3, 180.0, 'USD', 1.0, "partial take profit"),
        ("MSFT", "2024-02-01", "BUY", 8, 300.0, 'USD', 1.0, "entry"),
        ("MSFT", "2024-05-01", "BUY", 4, 320.0, 'USD', 1.0, "add position"),
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
    unrealized = calculate_total_unrealized_pnl()
    realized = calculate_total_realized_pnl()
    
    print("\nHOLDINGS:", holdings)
    print(f"PORTFOLIO VALUE: {total_value:.2f} EUR")
    print(f"TOTAL UNREALIZED P&L: {unrealized:.2f} EUR")
    print(f"TOTAL REALIZED P&L: {realized:.2f} EUR")
    print(f"Total P&L: {(realized + unrealized):.2f} EUR")



if __name__ == "__main__":
    main()
