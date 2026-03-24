import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
from db.database import get_connection
from utils.logger import setup_logger

logger = setup_logger()

def get_last_date(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
                       SELECT MAX(date) FROM stock_data WHERE ticker = ?
                       """, (ticker,))
        return cursor.fetchone()[0]

def fetch_stock_data(ticker, start_date, end_date):
    try:
        return yf.download(ticker, start=start_date, end=end_date, interval='1d')
    except Exception as e:
        logger.exception(f"Fetch failed for {ticker}")
        return None

def save_to_db(ticker, data):
    if data.empty:
        return

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    data = data.reset_index()

    data['Date'] = pd.to_datetime(data['Date']).dt.strftime('%Y-%m-%d')

    rows = list(zip(
        [ticker] * len(data),
        data['Date'],
        data['Open'],
        data['High'],
        data['Low'],
        data['Close'],
        data.get('Adj Close', data['Close']),
        data['Volume'].astype(int)
    ))

    with get_connection() as conn:
        conn.executemany("""
            INSERT OR REPLACE INTO stock_data
            (ticker, date, open, high, low, close, adj_close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

def update_ticker(ticker):
    from datetime import datetime, timedelta

    today = datetime.today()

    try:
        last_date = get_last_date(ticker)

        if last_date:
            start_date = datetime.strptime(last_date, "%Y-%m-%d") + timedelta(days=1)
        else:
            start_date = today - timedelta(days=365)

        if start_date >= today:
            logger.info(f"{ticker} already up to date")
            return

        logger.info(f"Fetching {ticker}...")

        data = fetch_stock_data(ticker, start_date, today)

        if data is None or data.empty:
            logger.warning(f"No data found for ticker '{ticker}' (invalid or delisted)")
            return

        save_to_db(ticker, data)

        logger.info(f"{ticker} updated successfully")

    except Exception as e:
        logger.exception(f"Error updating {ticker}")

def get_latest_price(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
                       SELECT adj_close
                       FROM stock_data
                       WHERE ticker = ?
                       ORDER BY date DESC
                       LIMIT 1
                       """, (ticker,))
        
        result = cursor.fetchone()
    return result[0] if result else None

def get_trades_per_ticker(ticker):
    with get_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
                       SELECT date, action, quantity, price, currency, commission
                       FROM transactions
                       WHERE ticker = ?
                       ORDER BY date ASC
                       """, (ticker,))
        
        return cursor.fetchall()

def calculate_realized_pnl(ticker):
    trades = get_trades_per_ticker(ticker)
    if not trades:
        logger.info(f"No trades found for {ticker}")
        return 0.0
    
    total_shares = 0.0
    realized_pnl = 0.0
    total_cost = 0.0

    for date, action, quantity, price, currency, commission in trades:
        
        if action == "BUY":
            total_cost += quantity * price + commission
            total_shares += quantity
            logger.debug(f"{ticker} BUY: {quantity} shares at {price}, total shares: {total_shares}")
        
        elif action == "SELL":
            if total_shares <= 0:
                logger.warning(f"SELL action for {ticker} without shares to sell")
                continue
            
            avg_price = total_cost / total_shares
            
            sell_value = quantity * price - commission
            cost_basis = quantity * avg_price
            
            realized_pnl += sell_value - cost_basis
            
            total_shares -= quantity
            total_cost -= cost_basis
            logger.debug(f"{ticker} SELL: {quantity} shares at {price}, realized PnL: {sell_value - cost_basis}")
    
    avg_price = total_cost / total_shares if total_shares > 0 else 0
    logger.info(f"{ticker} PnL calculation: shares={total_shares}, avg_price={avg_price}, realized_pnl={realized_pnl}")
    
    return {
        "shares": total_shares,
        "avg_price": avg_price,
        "realized_pnl": realized_pnl
    }

def calculate_unrealized_pnl(ticker):
    pnl_data = calculate_realized_pnl(ticker)
    
    shares = pnl_data["shares"] 
    avg_price = pnl_data["avg_price"]
    
    if shares <= 0:
        logger.warning(f"Unrealized pnl action for {ticker} without shares to calculate")
        return 0
    
    current_price = get_latest_price(ticker)
    
    if current_price is None:
        logger.warning(f"Cannot calculate unrealized pnl for {ticker} - no price data")
        return 0
    
    return (current_price - avg_price) * shares
