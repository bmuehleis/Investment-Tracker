from fastapi import APIRouter
from app.engines.pnl_engine import calculate_average_price
from app.repositories.portfolio_repository import get_ticker_holdings

router = APIRouter()

@router.get("/get_holdings/{ticker}")
def get_holdings(ticker: str):
    return {"holdings": get_ticker_holdings(ticker)}

@router.get("/get_average_price/{ticker}")
def get_average_price(ticker: str):
    return {"average_price": calculate_average_price(ticker)}