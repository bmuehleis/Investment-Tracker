from fastapi import APIRouter
from services.pnl_calc import calculate_total_unrealized_pnl, calculate_total_realized_pnl

router = APIRouter(prefix="/portfolio")

@router.get("/unrealized")
def unrealized():
    return {"unrealized": calculate_total_unrealized_pnl()}

@router.get("/realized")
def realized():
    return {"realized": calculate_total_realized_pnl()}