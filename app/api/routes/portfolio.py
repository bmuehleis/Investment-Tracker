from fastapi import APIRouter
from app.services.pnl_service import (
    calculate_total_unrealized_pnl,
    calculate_total_realized_pnl
)

router = APIRouter()


@router.get("/unrealized")
def unrealized(currency: str = "EUR"):
    return {
        "unrealized": calculate_total_unrealized_pnl(currency),
        "currency": currency
    }


@router.get("/realized")
def realized(currency: str = "EUR"):
    return {
        "realized": calculate_total_realized_pnl(currency),
        "currency": currency
    }


@router.get("/total")
def total(currency: str = "EUR"):
    return {
        "total": calculate_total_unrealized_pnl(currency)
               + calculate_total_realized_pnl(currency),
        "currency": currency
    }