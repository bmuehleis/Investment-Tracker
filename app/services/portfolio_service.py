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

def _compute_cost_basis_fifo(trades: list[dict]) -> float:
    """
    Returns the total cost basis (in trade currency) of the currently
    held shares using FIFO. Sells consume the oldest buy lots first.
    The returned value is the sum of (shares_remaining * buy_price) for
    all open lots — i.e. the original purchase cost of what is still held.
    """
    buy_queue: list[dict] = []  # [{"shares": float, "price": float}]
 
    for t in trades:
        qty = t["quantity"]
        price = t["price"]
 
        if t["action"] == "BUY":
            buy_queue.append({"shares": qty, "price": price})
 
        elif t["action"] == "SELL":
            remaining = qty
            while remaining > 0 and buy_queue:
                lot = buy_queue[0]
                used = min(lot["shares"], remaining)
                lot["shares"] -= used
                remaining -= used
                if lot["shares"] <= 0:
                    buy_queue.pop(0)
 
    return sum(lot["shares"] * lot["price"] for lot in buy_queue)


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

def calculate_portfolio_cost_basis_on_day(
    tickers: list[str],
    day_str: str,
    target_currency: str,
) -> float:
    """
    Returns the total cost basis of all currently held positions as of
    day_str, converted to target_currency.  This is the amount of capital
    that is actively invested (i.e. what was paid for shares still held).
    """
    total = 0.0
 
    for ticker in tickers:
        trades = get_trades_up_to(ticker, day_str)
        if not trades:
            continue
 
        # Determine the trade currency from the first trade for this ticker
        trade_currency = trades[0].get("currency") or "USD"
 
        cost_in_trade_currency = _compute_cost_basis_fifo(trades)
        if cost_in_trade_currency <= 0:
            continue
 
        fx = get_cached_fx_rate(trade_currency, target_currency)
        total += cost_in_trade_currency * fx
 
    return total