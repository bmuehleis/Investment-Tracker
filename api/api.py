from fastapi import FastAPI
from api.routes.trades import router as trades_router
from api.routes.portfolio import router as portfolio_router

app = FastAPI(title="Investment Tracker API", version="1.0")

app.include_router(trades_router)
app.include_router(portfolio_router)