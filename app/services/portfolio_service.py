from app.repositories.fx_repository import get_cached_fx_rate
from app.repositories.stock_repository import get_price_on_or_before
from app.repositories.trades_repository import get_trades_up_to


def _compute_holdings(trades: list[dict]) -> float:
    qty = 0.0
    for t in trades:
        if t["action"] == "BUY":
            qty += t["quantity"]
        elif t["action"] == "SELL":
            qty -= t["quantity"]
    return max(qty, 0.0)


def calculate_portfolio_value_on_day(
    tickers: list[str],
    day_str: str,
    target_currency: str,
) -> float | None:

    total = 0.0
    has_data = False

    for ticker in tickers:
        trades = get_trades_up_to(ticker, day_str)
        if not trades:
            continue

        holdings = _compute_holdings(trades)
        if holdings <= 0:
            continue

        price, stock_currency = get_price_on_or_before(ticker, day_str)
        if price is None:
            continue

        fx = get_cached_fx_rate(stock_currency or "USD", target_currency)
        value_in_target = holdings * price * fx

        total += value_in_target
        has_data = True

    return total if has_data else None