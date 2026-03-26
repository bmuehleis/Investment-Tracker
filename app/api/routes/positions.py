from fastapi import APIRouter
from app.engines.pnl_engine import calculate_average_price
from app.repositories.portfolio_repository import get_latest_price, get_ticker_holdings
from app.repositories.trades_repository import get_all_tickers

router = APIRouter()

@router.get("/get_holdings/{ticker}")
def get_holdings(ticker: str):
    return {"holdings": get_ticker_holdings(ticker)}

@router.get("/get_average_price/{ticker}")
def get_average_price(ticker: str):
    return {"average_price": calculate_average_price(ticker)}

@router.get("/get_positions")
def get_positions():
    positions = []

    tickers = get_all_tickers()

    for ticker in tickers:
        qty = get_ticker_holdings(ticker)
        if qty <= 0:
            continue

        avg = calculate_average_price(ticker)
        price = get_latest_price(ticker)

        market_value = qty * price
        cost = qty * avg
        gain = market_value - cost
        ret = (gain / cost * 100) if cost > 0 else 0

        positions.append({
            "ticker": ticker,
            "quantity": qty,
            "avg_cost": avg,
            "current_price": price,
            "market_value": market_value,
            "gain_loss": gain,
            "return_pct": ret,
            "currency": "USD"
        })

    return {"positions": positions}