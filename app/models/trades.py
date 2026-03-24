from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class TradeCreate(BaseModel):
    ticker: str
    action: str # BUY or SELL
    quantity: float
    price: float
    commission: float = 1.0
    currency: str = 'EUR'
    date: Optional[datetime] = None
    note: Optional[str] = None
