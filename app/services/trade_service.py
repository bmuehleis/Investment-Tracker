"""
trade_service.py

Business logic for trade operations:
- add_trade:    validate ticker via yfinance, persist trade, bootstrap stock data
- edit_trade:   update trade, re-evaluate whether stock data needs extending
- delete_trade: remove trade, purge orphaned stock data rows if ticker is gone
- export_csv:   stream all trades as a CSV string
- import_csv:   parse a CSV, validate each row, bulk-insert trades
"""

import csv
import io
from datetime import datetime

from app.core.logger import setup_logger
from app.repositories.trades_repository import (
    log_trade,
    edit_trade,
    delete_trade,
    get_all_trades,
    get_all_tickers,
    get_oldest_trade_date_for_ticker,
)
from app.repositories.stock_repository import get_last_date
from app.services.stock_service import bootstrap_ticker, update_ticker

logger = setup_logger()

# ── CSV column spec ──────────────────────────────────────────────────────────
CSV_COLUMNS = ["ticker", "date", "action", "quantity", "price", "commission", "currency", "note"]

# ─────────────────────────────────────────────
# ADD TRADE
# ─────────────────────────────────────────────

def add_trade_with_bootstrap(trade_data: dict) -> tuple[bool, str]:
    """
    1. Validate ticker via yfinance.
    2. Persist the trade.
    3. Bootstrap / extend stock_data for that ticker.

    Returns (success, message).
    """
    ticker = trade_data.get("ticker", "").upper().strip()
    if not ticker:
        return False, "Ticker is required."

    # Step 1: validate + bootstrap (fetches from oldest trade date)
    # We insert the trade first so get_oldest_trade_date_for_ticker works correctly
    try:
        log_trade(**{**trade_data, "ticker": ticker})
        logger.info(f"add_trade: persisted trade for {ticker}")
    except Exception as exc:
        logger.error(f"add_trade: DB insert failed for {ticker}: {exc}")
        return False, f"Failed to save trade: {exc}"

    # Step 2: bootstrap stock data (includes yfinance validation)
    ok, msg = bootstrap_ticker(ticker)
    if not ok:
        # Trade is saved but data fetch failed — inform caller
        logger.warning(f"add_trade: ticker '{ticker}' saved but stock data unavailable: {msg}")
        return False, (
            f"Trade saved, but stock data could not be loaded: {msg}. "
            "The trade is recorded; price history may be missing."
        )

    return True, f"Trade saved and data loaded for '{ticker}'."


# ─────────────────────────────────────────────
# EDIT TRADE
# ─────────────────────────────────────────────

def edit_trade_with_update(trade_id: int, trade_data: dict) -> tuple[bool, str]:
    """
    Update a trade and ensure stock data covers the (possibly earlier) new date.
    """
    ticker = trade_data.get("ticker", "").upper().strip()
    if not ticker:
        return False, "Ticker is required."

    try:
        edit_trade(trade_id, **{**trade_data, "ticker": ticker})
        logger.info(f"edit_trade: updated trade #{trade_id} for {ticker}")
    except Exception as exc:
        logger.error(f"edit_trade: failed for #{trade_id}: {exc}")
        return False, f"Failed to update trade: {exc}"

    # Re-bootstrap in case the edited date is earlier than existing data
    ok, msg = bootstrap_ticker(ticker)
    if not ok:
        logger.warning(f"edit_trade: stock data refresh failed for '{ticker}': {msg}")
        return True, f"Trade #{trade_id} updated, but stock data refresh failed: {msg}"

    return True, f"Trade #{trade_id} updated."


# ─────────────────────────────────────────────
# DELETE TRADE
# ─────────────────────────────────────────────

def delete_trade_with_cleanup(trade_id: int) -> tuple[bool, str]:
    """
    Delete a trade. Stock data is intentionally kept (no hard delete of price history).
    """
    try:
        delete_trade(trade_id)
        logger.info(f"delete_trade: removed trade #{trade_id}")
        return True, f"Trade #{trade_id} deleted."
    except Exception as exc:
        logger.error(f"delete_trade: failed for #{trade_id}: {exc}")
        return False, f"Failed to delete trade: {exc}"


# ─────────────────────────────────────────────
# CSV EXPORT
# ─────────────────────────────────────────────

def export_trades_csv() -> str:
    """Return all trades serialised as a CSV string."""
    trades = get_all_trades()
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for trade in trades:
        writer.writerow({col: trade.get(col, "") for col in CSV_COLUMNS})
    return output.getvalue()


# ─────────────────────────────────────────────
# CSV IMPORT
# ─────────────────────────────────────────────

_REQUIRED_COLS = {"ticker", "date", "action", "quantity", "price"}
_VALID_ACTIONS = {"BUY", "SELL"}


def import_trades_csv(csv_text: str) -> dict:
    """
    Parse and validate a CSV string, then insert valid rows.

    Returns a summary dict:
      {
        "imported":  int,     # rows successfully inserted
        "skipped":   int,     # rows with errors (not inserted)
        "errors":    [str],   # per-row error descriptions
      }
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames is None:
        return {"imported": 0, "skipped": 0, "errors": ["Empty or invalid CSV."]}

    missing = _REQUIRED_COLS - {c.strip().lower() for c in (reader.fieldnames or [])}
    if missing:
        return {
            "imported": 0,
            "skipped": 0,
            "errors": [f"CSV is missing required columns: {', '.join(sorted(missing))}"],
        }

    imported = 0
    skipped  = 0
    errors   = []
    tickers_to_bootstrap: set[str] = set()

    for line_no, row in enumerate(reader, start=2):  # start=2: row 1 is the header
        # Normalise keys
        row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}

        ticker = row.get("ticker", "").upper()
        action = row.get("action", "").upper()
        date_raw = row.get("date", "")
        qty_raw  = row.get("quantity", "")
        price_raw = row.get("price", "")

        # ── Validate ────────────────────────────────────────────────────────
        row_errors = []

        if not ticker:
            row_errors.append("missing ticker")

        if action not in _VALID_ACTIONS:
            row_errors.append(f"invalid action '{action}' (expected BUY or SELL)")

        try:
            datetime.strptime(date_raw[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            row_errors.append(f"invalid date '{date_raw}'")

        try:
            qty = float(qty_raw)
            if qty <= 0:
                raise ValueError
        except (ValueError, TypeError):
            row_errors.append(f"invalid quantity '{qty_raw}'")
            qty = None

        try:
            price = float(price_raw)
            if price <= 0:
                raise ValueError
        except (ValueError, TypeError):
            row_errors.append(f"invalid price '{price_raw}'")
            price = None

        if row_errors:
            errors.append(f"Row {line_no} ({ticker or '?'}): {'; '.join(row_errors)}")
            skipped += 1
            continue

        # ── Insert ──────────────────────────────────────────────────────────
        try:
            commission = float(row.get("commission") or 0)
        except (ValueError, TypeError):
            commission = 0.0

        trade_payload = {
            "ticker":     ticker,
            "date":       date_raw[:10] + "T00:00:00",
            "action":     action,
            "quantity":   qty,
            "price":      price,
            "commission": commission,
            "currency":   (row.get("currency") or "EUR").upper(),
            "note":       row.get("note", ""),
        }

        try:
            log_trade(**trade_payload)
            imported += 1
            tickers_to_bootstrap.add(ticker)
        except Exception as exc:
            errors.append(f"Row {line_no} ({ticker}): DB insert failed — {exc}")
            skipped += 1

    # Bootstrap stock data for every new ticker encountered
    for ticker in tickers_to_bootstrap:
        ok, msg = bootstrap_ticker(ticker)
        if not ok:
            logger.warning(f"import_csv: stock bootstrap failed for '{ticker}': {msg}")
            errors.append(f"Stock data for '{ticker}' could not be loaded: {msg}")

    logger.info(f"import_csv: imported={imported}, skipped={skipped}")
    return {"imported": imported, "skipped": skipped, "errors": errors}
