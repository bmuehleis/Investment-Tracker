import sqlite3
from app.core.config import DB_NAME

def get_connection():
    return sqlite3.connect(DB_NAME)

def create_tables():
    with get_connection() as conn:
        conn.execute("""
                     CREATE TABLE IF NOT EXISTS stock_data (
                         ticker TEXT,
                         date TEXT,
                         open REAL,
                         high REAL,
                         low REAL,
                         close REAL,
                         adj_close REAL,
                         volume INTEGER,
                         PRIMARY KEY (ticker, date)
                         )
                         """)
        
        conn.execute("""
                     CREATE TABLE IF NOT EXISTS transactions (
                         id INTEGER PRIMARY KEY AUTOINCREMENT,
                         ticker TEXT NOT NULL,
                         date TEXT NOT NULL,
                         action TEXT NOT NULL,
                         quantity REAL NOT NULL,
                         price REAL NOT NULL,
                         commission REAL DEFAULT 0,
                         currency TEXT NOT NULL DEFAULT 'EUR',
                         note TEXT
                         )
                         """)
        
        conn.execute("""
                     CREATE TABLE IF NOT EXISTS fx_rates (
                         pair TEXT PRIMARY KEY,
                         rate REAL NOT NULL,
                         provider TEXT,
                         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                         )
                         """)
