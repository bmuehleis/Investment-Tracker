import requests
from datetime import date
from app.core.logger import setup_logger
from app.core.config import FX_API
from app.repositories.fx_repository import save_fx_rate, get_cached_fx_rate

logger = setup_logger()

# ---------------------------------------------------------------------------
# In-process FX rate cache
# ---------------------------------------------------------------------------
# Structure: { "USD->EUR": {"rate": 0.92, "date": date(2024, 6, 1)}, ... }
#
# Lifetime: the process lifetime (i.e. until the server restarts).
# TTL: one calendar day — an entry is valid as long as its stored date equals
#      today's date.  The very first call for a pair on a new day will fetch
#      from the API and refresh the entry; all subsequent calls that day
#      (across every ticker, endpoint, and request) reuse the cached rate.
#
# This means a portfolio with 20 tickers in 3 different currencies produces
# at most 3 API calls per day instead of 20+ calls per request.
# ---------------------------------------------------------------------------
_rate_cache: dict[str, dict] = {}


def _cache_key(from_currency: str, to_currency: str) -> str:
    return f"{from_currency.upper()}->{to_currency.upper()}"


def _get_cached_rate(from_currency: str, to_currency: str) -> float | None:
    """Return today's rate from the in-process cache, or None if stale/missing."""
    entry = _rate_cache.get(_cache_key(from_currency, to_currency))
    if entry and entry["date"] == date.today():
        return entry["rate"]
    return None


def _store_rate(from_currency: str, to_currency: str, rate: float) -> None:
    """Write a rate into the in-process cache, tagged with today's date."""
    _rate_cache[_cache_key(from_currency, to_currency)] = {
        "rate": rate,
        "date": date.today(),
    }


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get_fx_rate(from_currency: str, to_currency: str, provider: str = "ECB") -> float | None:
    """
    Return the FX rate for 1 unit of from_currency expressed in to_currency.

    Resolution order:
      1. In-process cache (same day)  → no I/O at all
      2. External FX API              → updates both caches on success
      3. DB fallback via fx_repository → last-resort, no date guarantee

    Returns None only if all three layers fail.
    """
    if from_currency.upper() == to_currency.upper():
        return 1.0

    # 1. In-process cache
    cached = _get_cached_rate(from_currency, to_currency)
    if cached is not None:
        logger.debug(f"[CACHE] FX {from_currency}->{to_currency} = {cached}")
        return cached

    # 2. Live API
    try:
        url = f"{FX_API}?base={from_currency}&quotes={to_currency}&providers={provider}"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()

        fx_rate = _parse_rate(data, to_currency)

        if fx_rate is None:
            raise ValueError(f"FX rate not found in API response: {data}")
        if not isinstance(fx_rate, (int, float)):
            raise ValueError(f"Invalid FX rate type: {type(fx_rate)}")

        # Persist to in-process cache and DB
        _store_rate(from_currency, to_currency, fx_rate)
        try:
            save_fx_rate(from_currency, to_currency, fx_rate, provider)
        except Exception as db_error:
            logger.warning(f"Failed to save FX rate to DB: {db_error}")

        logger.info(f"[API] FX {from_currency}->{to_currency} = {fx_rate}")
        return fx_rate

    except Exception as api_error:
        logger.error(f"FX API call failed ({from_currency}->{to_currency}): {api_error}")

    # 3. DB fallback (fx_repository)
    try:
        fx_rate = get_cached_fx_rate(from_currency, to_currency)
        if fx_rate is None:
            raise ValueError("No DB-cached FX rate available")

        # Store in process cache so subsequent calls this day don't hit DB either
        _store_rate(from_currency, to_currency, fx_rate)
        logger.info(f"[DB FALLBACK] FX {from_currency}->{to_currency} = {fx_rate}")
        return fx_rate

    except Exception as fallback_error:
        logger.error(f"FX DB fallback also failed ({from_currency}->{to_currency}): {fallback_error}")
        return None


def convert_if_needed(amount, from_currency: str, to_currency: str, rate_date=None) -> float:
    """
    Convert amount from from_currency to to_currency.
    Returns the original amount unchanged if:
      - currencies are identical, or
      - no rate could be obtained (fails gracefully).

    The rate_date parameter is accepted for API compatibility but ignored —
    rates are always today's rate on a 1-day TTL cache.
    """
    if from_currency == to_currency:
        return amount

    try:
        rate = get_fx_rate(from_currency, to_currency)
        if rate is None:
            logger.warning(
                f"No FX rate available for {from_currency}->{to_currency}, "
                f"returning unconverted amount."
            )
            return amount

        converted = round(amount * rate, 2)
        logger.debug(f"{amount} {from_currency} → {converted} {to_currency} (rate={rate})")
        return converted

    except Exception as e:
        logger.warning(f"convert_if_needed failed ({from_currency}->{to_currency}): {e}")
        return amount


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_rate(data, to_currency: str) -> float | None:
    """Extract the numeric rate from the various response shapes the API may return."""
    # Shape 1: [{"base": "USD", "quote": "EUR", "rate": 0.86}]
    if isinstance(data, list) and data:
        return data[0].get("rate")

    # Shape 2a: {"rates": {"EUR": 0.86}}
    # Shape 2b: {"rates": [{"currency": "EUR", "rate": 0.86}]}
    if isinstance(data, dict):
        rates = data.get("rates")
        if isinstance(rates, dict):
            return rates.get(to_currency)
        if isinstance(rates, list):
            return next(
                (item.get("rate") for item in rates if item.get("currency") == to_currency),
                None,
            )

    return None