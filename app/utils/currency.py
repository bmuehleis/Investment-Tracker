import requests
from datetime import datetime
from app.core.logger import setup_logger
from app.core.config import FX_API
from app.repositories.fx_repository import save_fx_rate, get_cached_fx_rate

logger = setup_logger()

def convert_if_needed(amount, from_currency, to_currency, rate_date=None):
    """
    Convert amount from one currency to another only if they differ.
    If currencies are the same, returns amount unchanged.

    Args:
        amount: Value to convert
        from_currency: Source currency code (e.g., 'EUR')
        to_currency: Target currency code (e.g., 'USD')
        rate_date: Optional date string for historical rate lookup (YYYY-MM-DD)

    Returns:
        Converted amount in to_currency, or original amount if conversion not needed/fails
    """
    if from_currency == to_currency:
        return amount

    try:
        converted = convert_currency_api(amount, from_currency, to_currency)
        return converted if converted is not None else amount
    except Exception as e:
        logger.warning(f"Failed to convert {amount} {from_currency} to {to_currency}: {e}")
        return amount

def convert_currency_api(amount, from_currency, to_currency, provider="ECB"):
    try:
        url = f"{FX_API}?base={from_currency}&quotes={to_currency}&providers={provider}"
        response = requests.get(url, timeout=5)
        response.raise_for_status()

        data = response.json()

        fx_rate = None

        # Case 1: Expected format (your current API)
        # [
        #   { "base": "USD", "quote": "EUR", "rate": 0.86 }
        # ]
        if isinstance(data, list) and len(data) > 0:
            fx_rate = data[0].get("rate")

        # Case 2: Alternative dict format (future-proof)
        # { "rates": { "EUR": 0.86 } }
        elif isinstance(data, dict):
            rates = data.get("rates")

            if isinstance(rates, dict):
                fx_rate = rates.get(to_currency)

            elif isinstance(rates, list):
                fx_rate = next(
                    (item.get("rate") for item in rates if item.get("currency") == to_currency),
                    None
                )

        if fx_rate is None:
            raise ValueError(f"FX rate not found in API response: {data}")

        if not isinstance(fx_rate, (int, float)):
            raise ValueError(f"Invalid FX rate type: {fx_rate}")

        converted_amount = round(amount * fx_rate, 2)

        try:
            save_fx_rate(from_currency, to_currency, fx_rate, provider)
        except Exception as db_error:
            logger.warning(f"Failed to save FX rate: {db_error}")

        logger.info(
            f"[API] {amount} {from_currency} = {converted_amount} {to_currency} (rate={fx_rate})"
        )

        return converted_amount

    except Exception as e:
        logger.error(f"Currency conversion failed (API): {e}")

        try:
            fx_rate = get_cached_fx_rate(from_currency, to_currency)

            if fx_rate is None:
                raise ValueError("No cached FX rate available")

            converted_amount = round(amount * fx_rate, 2)

            logger.info(
                f"[FALLBACK] {amount} {from_currency} = {converted_amount} {to_currency} (rate={fx_rate})"
            )

            return converted_amount

        except Exception as fallback_error:
            logger.error(f"Currency conversion failed (fallback): {fallback_error}")
            return None