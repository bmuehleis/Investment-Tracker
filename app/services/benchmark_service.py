"""
benchmark_service.py

Calculates portfolio performance KPIs and fetches benchmark data for comparison.
KPIs: Total Return (absolute + annualised), Variance (Risk), Sharpe Ratio, Sortino Ratio (XLM).
Benchmarks: S&P 500 (^GSPC), MSCI World (^990100-USD-STRD).

"""

import math
from datetime import date, timedelta
from typing import Optional

import yfinance as yf

from app.core.logger import setup_logger
from app.repositories.trades_repository import get_all_tickers, get_first_trade_date
from app.services.portfolio_service import calculate_portfolio_value_on_day
from app.utils.risk_free import _get_risk_free_rate

logger = setup_logger()

RISK_FREE_RATE_ANNUAL = _get_risk_free_rate()

# Benchmark tickers on Yahoo Finance
BENCHMARKS = {
    "sp500":    {"label": "S&P 500",    "ticker": "^GSPC"},
    "msci_world": {"label": "MSCI World", "ticker": "^990100-USD-STRD"},
}

PERIODS = {
    "1y":  365,
    "3y":  365 * 3,
    "5y":  365 * 5,
    "10y": 365 * 10,
    "max": None,
}


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _sample_dates(start: date, end: date, n_points: int = 60) -> list[date]:
    """Return up to n_points evenly spaced dates between start and end (inclusive)."""
    delta = (end - start).days
    if delta <= 0:
        return [start]
    step = max(1, delta // n_points)
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=step)
    if days[-1] != end:
        days.append(end)
    return days


def _to_returns(values: list[float]) -> list[float]:
    """Convert a list of values to period-over-period returns."""
    if len(values) < 2:
        return []
    return [(values[i] - values[i - 1]) / values[i - 1] for i in range(1, len(values))]


def _annualise_return(total_return: float, days: int) -> float:
    """Convert a total return over `days` to an annualised rate."""
    if days <= 0:
        return 0.0
    years = days / 365.25
    if years == 0:
        return 0.0
    try:
        return (1 + total_return) ** (1 / years) - 1
    except Exception:
        return 0.0


def _variance(returns: list[float]) -> float:
    if len(returns) < 2:
        return 0.0
    n = len(returns)
    mean = sum(returns) / n
    return sum((r - mean) ** 2 for r in returns) / (n - 1)


def _annualised_variance(daily_returns: list[float]) -> float:
    """Annualise daily variance (multiply by 252 trading days)."""
    return _variance(daily_returns) * 252


def _sharpe(returns: list[float], rf_daily: float) -> float:
    if len(returns) < 2:
        return 0.0
    n = len(returns)
    mean = sum(returns) / n - rf_daily
    std = math.sqrt(_variance(returns))
    if std == 0:
        return 0.0
    return (mean / std) * math.sqrt(252)


def _sortino(returns: list[float], rf_daily: float) -> float:
    """Sortino Ratio (XLM KPI) — only downside deviation in denominator."""
    if len(returns) < 2:
        return 0.0
    n = len(returns)
    mean = sum(returns) / n - rf_daily
    downside = [min(r - rf_daily, 0) for r in returns]
    downside_var = sum(d ** 2 for d in downside) / max(len(downside) - 1, 1)
    downside_std = math.sqrt(downside_var)
    if downside_std == 0:
        return 0.0
    return (mean / downside_std) * math.sqrt(252)


# ─────────────────────────────────────────────────────────────────────────────
# Portfolio time-series builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_portfolio_series(
    start: date,
    end: date,
    currency: str,
    n_points: int = 60,
) -> tuple[list[date], list[float]]:
    """
    Return (dates, values) for the portfolio between start and end.
    Values are in the given currency.
    """
    tickers = get_all_tickers()
    if not tickers:
        return [], []

    sample = _sample_dates(start, end, n_points)
    dates_out, values_out = [], []

    for d in sample:
        val = calculate_portfolio_value_on_day(tickers, d.isoformat(), currency)
        if val is not None:
            dates_out.append(d)
            values_out.append(val)

    return dates_out, values_out


# ─────────────────────────────────────────────────────────────────────────────
# Benchmark time-series builder
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_benchmark_series(
    yf_ticker: str,
    start: date,
    end: date,
) -> tuple[list[date], list[float]]:
    """Download adjusted-close prices from Yahoo Finance for a benchmark."""
    try:
        raw = yf.download(
            yf_ticker,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=True,
            progress=False,
        )
        if raw.empty:
            logger.warning(f"No benchmark data for {yf_ticker}")
            return [], []

        # Flatten MultiIndex columns if present
        if hasattr(raw.columns, "levels"):
            raw.columns = raw.columns.get_level_values(0)

        closes = raw["Close"].dropna()
        dates_out = [d.date() if hasattr(d, "date") else d for d in closes.index.tolist()]
        values_out = [float(v) for v in closes.values.tolist()]
        return dates_out, values_out
    except Exception:
        logger.exception(f"Failed to fetch benchmark series for {yf_ticker}")
        return [], []


# ─────────────────────────────────────────────────────────────────────────────
# KPI calculation
# ─────────────────────────────────────────────────────────────────────────────

def _compute_kpis(dates: list[date], values: list[float]) -> dict:
    """Compute all KPIs for a value time-series."""
    if len(values) < 2:
        return {
            "total_return": None,
            "annualised_return": None,
            "variance": None,
            "sharpe": None,
            "sortino": None,
            "start_value": None,
            "end_value": None,
            "days": 0,
        }

    start_val = values[0]
    end_val = values[-1]
    days = (dates[-1] - dates[0]).days

    total_return = (end_val - start_val) / start_val if start_val else 0.0
    ann_return = _annualise_return(total_return, days)

    daily_returns = _to_returns(values)
    rf_daily = RISK_FREE_RATE_ANNUAL / 252
    ann_variance = _annualised_variance(daily_returns)
    sharpe = _sharpe(daily_returns, rf_daily)
    sortino = _sortino(daily_returns, rf_daily)

    return {
        "total_return": round(total_return * 100, 2),          # %
        "annualised_return": round(ann_return * 100, 2),        # %
        "variance": round(ann_variance * 100, 4),               # % (annualised)
        "sharpe": round(sharpe, 4),
        "sortino": round(sortino, 4),
        "start_value": round(start_val, 2),
        "end_value": round(end_val, 2),
        "days": days,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def get_benchmark_data(
    period: str = "1y",
    currency: str = "EUR",
    benchmark_keys: Optional[list[str]] = None,
) -> dict:
    """
    Main entry point for the benchmark route.

    Returns a dict with:
      - portfolio_kpis: KPIs per requested period
      - benchmarks: {key: {label, kpis}} per selected benchmark
      - available_benchmarks: list of {key, label}
      - period, currency
    """
    today = date.today()

    first_trade_str = get_first_trade_date()
    if not first_trade_str:
        return {
            "portfolio_kpis": None,
            "benchmarks": {},
            "available_benchmarks": [
                {"key": k, "label": v["label"]} for k, v in BENCHMARKS.items()
            ],
            "period": period,
            "currency": currency,
            "error": "No trades found in portfolio.",
        }

    first_trade_date = date.fromisoformat(first_trade_str[:10])

    # Determine window for selected period
    days = PERIODS.get(period)
    if days is None:
        start = first_trade_date
    else:
        start = max(today - timedelta(days=days), first_trade_date)
    end = today

    # Build portfolio series
    port_dates, port_values = _build_portfolio_series(start, end, currency)
    portfolio_kpis = _compute_kpis(port_dates, port_values)

    # Build benchmark KPIs
    if benchmark_keys is None:
        benchmark_keys = []

    benchmarks_out = {}
    for key in benchmark_keys:
        meta = BENCHMARKS.get(key)
        if not meta:
            continue
        b_dates, b_values = _fetch_benchmark_series(meta["ticker"], start, end)
        kpis = _compute_kpis(b_dates, b_values)
        benchmarks_out[key] = {
            "label": meta["label"],
            "ticker": meta["ticker"],
            "kpis": kpis,
        }

    return {
        "portfolio_kpis": portfolio_kpis,
        "benchmarks": benchmarks_out,
        "available_benchmarks": [
            {"key": k, "label": v["label"]} for k, v in BENCHMARKS.items()
        ],
        "period": period,
        "currency": currency,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
    }


def get_all_period_kpis(currency: str = "EUR") -> dict:
    """
    Compute portfolio KPIs for all standard periods at once.
    Returns {period: kpis_dict} plus available_benchmarks list.
    """
    today = date.today()
    first_trade_str = get_first_trade_date()
    if not first_trade_str:
        return {"periods": {}, "available_benchmarks": [
            {"key": k, "label": v["label"]} for k, v in BENCHMARKS.items()
        ]}

    first_trade_date = date.fromisoformat(first_trade_str[:10])

    results = {}
    for period, days in PERIODS.items():
        start = first_trade_date if days is None else max(today - timedelta(days=days), first_trade_date)
        end = today

        # Skip periods before first trade
        if start >= end:
            results[period] = None
            continue

        port_dates, port_values = _build_portfolio_series(start, end, currency)
        results[period] = _compute_kpis(port_dates, port_values)

    return {
        "periods": results,
        "available_benchmarks": [
            {"key": k, "label": v["label"]} for k, v in BENCHMARKS.items()
        ],
        "currency": currency,
    }
