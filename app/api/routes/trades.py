from fastapi import APIRouter
from app.models.trades import TradeCreate
from app.repositories.trades_repository import (
    log_trade,
    get_all_trades,
    delete_trade,
    edit_trade
)

router = APIRouter(tags=["Trades"])

@router.get("/")
def list_trades():
    return {"trades": get_all_trades()}

@router.post("/")
def add_trade(trade: TradeCreate):
    log_trade(**trade.model_dump())
    return {"status": "ok"}

@router.put("/{trade_id}")
def update_trade(trade_id: int, trade: TradeCreate):
    edit_trade(trade_id, **trade.model_dump())
    return {"status": "ok"}

@router.delete("/{trade_id}")
def remove_trade(trade_id: int):
    delete_trade(trade_id)
    return {"status": "ok"}