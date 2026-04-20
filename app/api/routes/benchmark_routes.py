"""
benchmark_routes.py

GET /api/v1/benchmark/kpis
  Query params:
    - period:    "1y" | "3y" | "5y" | "10y" | "max"  (default "1y")
    - currency:  target display currency               (default "EUR")
    - benchmark: one or more benchmark keys            (repeatable, e.g. ?benchmark=sp500&benchmark=msci_world)

GET /api/v1/benchmark/all-periods
  Query params:
    - currency:  target display currency               (default "EUR")
  Returns KPIs for all periods at once (no benchmark comparison — used for the
  summary period table in the UI).

GET /api/v1/benchmark/available
  Returns the list of available benchmark definitions.
"""

from fastapi import APIRouter, Query
from typing import List

from app.services.benchmark_service import (
    get_benchmark_data,
    get_all_period_kpis,
    BENCHMARKS,
)

router = APIRouter()


@router.get("/kpis")
def benchmark_kpis(
    period: str = Query("1y", description="1y|3y|5y|10y|max"),
    currency: str = Query("EUR", description="Target display currency"),
    benchmark: List[str] = Query(default=[], description="Benchmark keys to compare"),
):
    """Return portfolio KPIs for a given period, plus selected benchmark KPIs."""
    currency = currency.upper()
    period = period.lower()
    return get_benchmark_data(
        period=period,
        currency=currency,
        benchmark_keys=benchmark,
    )


@router.get("/all-periods")
def all_period_kpis(
    currency: str = Query("EUR", description="Target display currency"),
    benchmark: List[str] = Query(default=[], description="Benchmark keys to include"),
):
    """Return portfolio KPIs for all standard periods, optionally with benchmarks."""
    currency = currency.upper()
    result = get_all_period_kpis(currency=currency)

    # Add benchmark data for each period if requested
    if benchmark:
        from app.services.benchmark_service import get_benchmark_data
        benchmark_periods: dict = {k: {} for k in benchmark}
        for period in result["periods"]:
            bm_data = get_benchmark_data(period=period, currency=currency, benchmark_keys=benchmark)
            for key, bm_info in bm_data.get("benchmarks", {}).items():
                benchmark_periods[key][period] = bm_info["kpis"]

        result["benchmark_periods"] = {
            key: {
                "label": BENCHMARKS[key]["label"],
                "periods": benchmark_periods[key],
            }
            for key in benchmark
            if key in BENCHMARKS
        }

    return result


@router.get("/available")
def available_benchmarks():
    """Return the list of selectable benchmarks."""
    return {
        "benchmarks": [
            {"key": k, "label": v["label"], "ticker": v["ticker"]}
            for k, v in BENCHMARKS.items()
        ]
    }
