import pandas as pd
from app.core.database import get_connection
from app.core.logger import setup_logger

logger = setup_logger()

def save_fx_rate(from_currency, to_currency, rate, provider):
    pair = f"{from_currency}_{to_currency}"
    
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
        
            cursor.execute("""
                           INSERT INTO fx_rates (pair, rate, provider, updated_at)
                           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                           ON CONFLICT(pair) DO UPDATE SET
                           rate = excluded.rate,
                           provider = excluded.provider,
                           updated_at = CURRENT_TIMESTAMP
                           """, (pair, rate, provider))
            conn.commit()
            logger.info(f"Saved FX rate: {pair} = {rate} from {provider}")
        
    except Exception as e:
        logger.error(f"Failed to save FX rate for {pair}: {str(e)}")

def get_cached_fx_rate(from_currency, to_currency):
    pair = f"{from_currency}_{to_currency}"

    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            row = cursor.execute(
                "SELECT rate FROM fx_rates WHERE pair = ?",
                (pair,)
            ).fetchone()
            rate = row[0] if row else None
            if rate:
                logger.info(f"Retrieved cached FX rate: {pair} = {rate}", cooldown=30, key=f"fx_rate_{pair}")
            else:
                logger.warning(f"No cached FX rate found for {pair}", cooldown=30, key=f"fx_rate_{pair}")
            return rate
    except Exception as e:
        logger.error(f"Failed to retrieve FX rate for {pair}: {str(e)}")
        return None