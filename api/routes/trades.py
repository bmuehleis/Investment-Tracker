from fastapi import APIRouter
from services.portfolio import log_trade, get_all_trades, delete_trade, edit_trade

router = APIRouter(prefix="/trades", tags=["Trades"])

@router.get("/")
def list_trades():
    trades = get_all_trades()
    return {"trades": trades}

@router.post("/")
def add_trade(trade: dict):
    if not trade:
        return {"status": "error", "message": "Trade data required"}
    log_trade(**trade)
    return {"status": "ok", "message": "Trade added successfully"}

@router.put("/{trade_id}")
def update_trade(trade_id: int, trade: dict):
    edit_trade(trade_id, **trade)
    return {"status": "ok"}

@router.delete("/{trade_id}")
def remove_trade(trade_id: int):
    delete_trade(trade_id)
    return {"status": "ok"}

