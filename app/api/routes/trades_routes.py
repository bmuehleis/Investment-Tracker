"""
trades_routes.py

GET    /api/v1/trades/           — list all trades
POST   /api/v1/trades/           — add trade (validates ticker + bootstraps stock data)
PUT    /api/v1/trades/{id}       — edit trade
DELETE /api/v1/trades/{id}       — delete trade
GET    /api/v1/trades/export     — download all trades as CSV
POST   /api/v1/trades/import     — upload a CSV file to bulk-import trades
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
import io

from app.core.logger import setup_logger
from app.models.trades import TradeCreate
from app.repositories.trades_repository import get_all_trades
from app.services.trade_service import (
    add_trade_with_bootstrap,
    edit_trade_with_update,
    delete_trade_with_cleanup,
    export_trades_csv,
    import_trades_csv,
)

logger = setup_logger()
router = APIRouter(tags=["Trades"])


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/")
def list_trades():
    return {"trades": get_all_trades()}


# ── Add ───────────────────────────────────────────────────────────────────────

@router.post("/")
def add_trade(trade: TradeCreate):
    ok, msg = add_trade_with_bootstrap(trade.model_dump())
    if not ok:
        # 422 so the frontend can surface the message without crashing
        raise HTTPException(status_code=422, detail=msg)
    return {"status": "ok", "message": msg}


# ── Edit ──────────────────────────────────────────────────────────────────────

@router.put("/{trade_id}")
def update_trade(trade_id: int, trade: TradeCreate):
    ok, msg = edit_trade_with_update(trade_id, trade.model_dump())
    if not ok:
        raise HTTPException(status_code=422, detail=msg)
    return {"status": "ok", "message": msg}


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{trade_id}")
def remove_trade(trade_id: int):
    ok, msg = delete_trade_with_cleanup(trade_id)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"status": "ok", "message": msg}


# ── CSV Export ────────────────────────────────────────────────────────────────

@router.get("/export")
def export_csv():
    """Return all trades as a downloadable CSV file."""
    logger.info("export_csv: building CSV")
    csv_data = export_trades_csv()
    return StreamingResponse(
        io.StringIO(csv_data),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=trades_export.csv"},
    )


# ── CSV Import ────────────────────────────────────────────────────────────────

@router.post("/import")
async def import_csv(file: UploadFile = File(...)):
    """Accept a CSV file and bulk-import the trades contained in it."""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")

    raw = await file.read()
    try:
        csv_text = raw.decode("utf-8-sig")  # handle BOM from Excel exports
    except UnicodeDecodeError:
        csv_text = raw.decode("latin-1")

    logger.info(f"import_csv: received file '{file.filename}' ({len(raw)} bytes)")
    result = import_trades_csv(csv_text)
    return result
