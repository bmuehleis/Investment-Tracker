from fastapi import FastAPI
from app.api.routes.trades import router as trades_router
from app.api.routes.portfolio import router as portfolio_router
from app.api.routes.positions import router as positions_router

app = FastAPI(
    title="Investment Tracker API",
    version="1.0"
)

app.include_router(trades_router, prefix="/api/v1/trades", tags=["Trades"])
app.include_router(portfolio_router, prefix="/api/v1/portfolio", tags=["Portfolio"])
app.include_router(positions_router, prefix="/api/v1/positions", tags=["Positions"])