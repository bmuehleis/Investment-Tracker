from fastapi import APIRouter
from app.engines.pnl_engine import calculate_average_price
from app.repositories.portfolio_repository import get_latest_price, get_ticker_holdings
from app.repositories.stock_repository import get_latest_currency
from app.repositories.trades_repository import get_all_tickers
from app.utils.currency import convert_if_needed

router = APIRouter()

@router.get("/get_holdings/{ticker}")
def get_holdings(ticker: str):
    return {"holdings": get_ticker_holdings(ticker)}

@router.get("/get_average_price/{ticker}")
def get_average_price(ticker: str, currency: str = "EUR"):
    return {"average_price": calculate_average_price(ticker, currency), "currency": currency}

@router.get("/get_positions")
def get_positions(currency: str = "EUR"):
    positions = []

    tickers = get_all_tickers()

    for ticker in tickers:
        qty = get_ticker_holdings(ticker)
        if qty <= 0:
            continue

        avg = calculate_average_price(ticker, currency)
        price = get_latest_price(ticker)

        # Convert current price to base currency using the stored stock currency
        stock_currency = get_latest_currency(ticker) or "USD"
        converted_price = convert_if_needed(price, stock_currency, currency)

        market_value = qty * converted_price
        cost = qty * avg
        gain = market_value - cost
        ret = (gain / cost * 100) if cost > 0 else 0

        positions.append({
            "ticker": ticker,
            "quantity": qty,
            "avg_cost": avg,
            "current_price": converted_price,
            "market_value": market_value,
            "gain_loss": gain,
            "return_pct": ret,
            "currency": currency
        })

    return {"positions": positions}