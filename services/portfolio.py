from db.database import get_connection
from utils.logger import setup_logger
from services.stock import get_latest_price
from services.stock import calculate_unrealized_pnl, calculate_realized_pnl

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

def calculate_total_unrealized_pnl():
    try:
        holdings = calculate_holdings()
        logger.info("Calculating total unrealized P&L...")
        
        total = 0.0
        
        for ticker in holdings.keys():
            unrealized_pnl = calculate_unrealized_pnl(ticker)
            total += unrealized_pnl
            logger.debug(f"{ticker}: Unrealized P&L = {unrealized_pnl:.2f}")
        
        logger.info(f"TOTAL UNREALIZED P&L: {total:.2f}")
        return total
    except Exception as e:
        logger.error(f"Error calculating total unrealized P&L: {str(e)}")
        return 0.0

def calculate_total_realized_pnl():
    try:
        holdings = calculate_holdings()
        logger.info("Calculating total realized P&L...")
        
        total = 0.0
        
        for ticker in holdings.keys():
            realized_pnl = calculate_realized_pnl(ticker)
            total += realized_pnl['realized_pnl']
            logger.debug(f"{ticker}: Realized P&L = {realized_pnl['realized_pnl']:.2f}")
        
        logger.info(f"TOTAL REALIZED P&L: {total:.2f}")
        return total
    except Exception as e:
        logger.error(f"Error calculating total realized P&L: {str(e)}")
        return 0.0
