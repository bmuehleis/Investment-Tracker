from fastapi import APIRouter
from app.services.pnl_service import (
    calculate_total_unrealized_pnl,
    calculate_total_realized_pnl
)

router = APIRouter()


@router.get("/unrealized")
def unrealized():
    return {"unrealized": calculate_total_unrealized_pnl()}


@router.get("/realized")
def realized():
    return {"realized": calculate_total_realized_pnl()}


@router.get("/total")
def total():
    return {
        "total": calculate_total_unrealized_pnl()
               + calculate_total_realized_pnl()
    }