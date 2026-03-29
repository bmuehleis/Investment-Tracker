"""
portfolio_history_routes.py
GET /api/v1/portfolio/history
Query params:
  - range:    "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL" | "CUSTOM"  (default "1M")
  - from_date: "YYYY-MM-DD"  (only used when range == "CUSTOM")
  - to_date:   "YYYY-MM-DD"  (only used when range == "CUSTOM", defaults to today)
  - currency:  target display currency (default "EUR")
"""

from datetime import date, timedelta
from fastapi import APIRouter, Query
from app.core.logger import setup_logger
from app.repositories.trades_repository import get_all_tickers, get_first_trade_date
from app.services.portfolio_service import calculate_portfolio_value_on_day

logger = setup_logger()
router = APIRouter()

# --------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------

def _date_range(start: date, end: date, window: str) -> list[date]:
    delta = (end - start).days
    if delta <= 0:
        return [start]
    
    if window in ("1W",):
        step = 1
    elif window in ("1M",):
        step = 1
    elif window in ("3M",):
        step = 2
    elif window in ("6M",):
        step = 3
    elif window in ("1Y",):
        step = 3
    else:  # ALL or CUSTOM > 1Y
        step = max(1, delta // 180)

    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=step)

    if days[-1] != end:
        days.append(end)

    return days

def _compute_holdings(trades: list[dict]) -> float:
    qty = 0.0
    for t in trades:
        if t["action"] == "BUY":
            qty += t["quantity"]
        elif t["action"] == "SELL":
            qty -= t["quantity"]
    return max(qty, 0.0)

# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

RANGE_TO_DAYS = {
    "1W": 7,
    "1M": 30,
    "3M": 90,
    "6M": 180,
    "1Y": 365,
    "ALL": None,
}


@router.get("/history")
def portfolio_history(
    range: str = Query("1M", description="1W|1M|3M|6M|1Y|ALL|CUSTOM"),
    from_date: str = Query(None, description="YYYY-MM-DD (CUSTOM range start)"),
    to_date: str = Query(None, description="YYYY-MM-DD (CUSTOM range end, defaults today)"),
    currency: str = Query("EUR", description="Target display currency"),
):
    today = date.today()
    currency = currency.upper()


    first_trade_str = get_first_trade_date()
    tickers = get_all_tickers()

    if not tickers or not first_trade_str:
        return {
            "labels": [],
            "values": [],
            "first_trade_date": None,
            "currency": currency,
        }

    first_trade_date = date.fromisoformat(first_trade_str)

    # --- Determine [range_start, range_end] ---
    if range == "CUSTOM":
        try:
            range_start = date.fromisoformat(from_date) if from_date else first_trade_date
            range_end = date.fromisoformat(to_date) if to_date else today
        except (ValueError, TypeError):
            range_start = first_trade_date
            range_end = today
    elif range == "ALL":
        range_start = first_trade_date
        range_end = today
    else:
        days_back = RANGE_TO_DAYS.get(range, 30)
        range_start = today - timedelta(days=days_back)
        range_end = today

    # Cap start to first trade — no point showing zeroes before any investment
    effective_start = max(range_start, first_trade_date)
    effective_end = min(range_end, today)

    if effective_start > effective_end:
        return {
            "labels": [],
            "values": [],
            "first_trade_date": first_trade_str,
            "currency": currency,
        }

    sample_days = _date_range(effective_start, effective_end, range)

    labels = []
    values = []

    for day in sample_days:
        day_str = day.isoformat()
        val = calculate_portfolio_value_on_day(tickers, day_str, currency)
        if val is not None:
            labels.append(day_str)
            values.append(round(val, 2))

    return {
        "labels": labels,
        "values": values,
        "first_trade_date": first_trade_str,
        "currency": currency,
    }
