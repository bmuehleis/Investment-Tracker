from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pathlib import Path
from app.api.routes.trades import router as trades_router
from app.api.routes.portfolio import router as portfolio_router
from app.api.routes.positions import router as positions_router


app = FastAPI(
    title="Investment Tracker API",
    version="1.0"
)

BASE_DIR = Path(__file__).resolve().parent.parent

templates = Jinja2Templates(directory=BASE_DIR / "frontend" / "templates")

app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR / "frontend" / "static"),
    name="static"
)

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
    request=request,
    name="index.html",
    context={}
    )


app.include_router(trades_router, prefix="/api/v1/trades", tags=["Trades"])
app.include_router(portfolio_router, prefix="/api/v1/portfolio", tags=["Portfolio"])
app.include_router(positions_router, prefix="/api/v1/positions", tags=["Positions"])