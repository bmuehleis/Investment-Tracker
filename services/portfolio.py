from db.database import get_connection
from utils.logger import setup_logger
from services.stock import get_latest_price

logger = setup_logger()

def log_trade(ticker, date, action, quantity, price, currency='EUR' ,commission=0, note=None):
    with get_connection() as conn:
        conn.execute("""
                     INSERT INTO transactions (ticker, date, action, quantity, price, currency, commission, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     """, (ticker, date, action.upper(), quantity, price, currency, commission, note))
    logger.info(f"Trade logged: {action} {quantity} {ticker} @ {price}")

def calculate_holdings():
    with get_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
                       SELECT ticker,
                       SUM(CASE WHEN action='BUY' THEN quantity ELSE -quantity END) as shares
                       FROM transactions
                       GROUP BY ticker
                       """)    
    return {row[0]: row[1] for row in cursor.fetchall()}

def calculate_portfolio_value():
    holdings = calculate_holdings()
    
    total_value = 0.0
    
    logger.info("Calculating portfolio value...")
    
    for ticker, shares in holdings.items():
        price = get_latest_price(ticker)
        
        if price is None:
            logger.warning(f"No price data for {ticker}")
            continue
        
        value = shares * price
        total_value += value
        
        logger.info(f"{ticker}: {shares} sharex x {price:.2f} = {value:.2f}")
        
    logger.info(f"TOTAL VALUE: {total_value:.2f}")
    return total_value