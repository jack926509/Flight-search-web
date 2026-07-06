import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import date as DateType

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import client as db_client
from db import repository as repo
from providers.amadeus_provider import AmadeusProvider
from providers.fast_flights_provider import FastFlightsProvider
from services.cached_search import CachedSearch
from services.search_chain import AllProvidersFailed, SearchChain

logger = logging.getLogger(__name__)

_fast_flights = FastFlightsProvider()
_amadeus = AmadeusProvider()
_chain = SearchChain([_fast_flights, _amadeus])
_cached_search: CachedSearch | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cached_search
    if os.getenv("SUPABASE_URL"):
        db = await db_client.get_client()
        _cached_search = CachedSearch(_chain, db)
        logger.info("CachedSearch ready")
    else:
        logger.warning("SUPABASE_URL not set — running without cache (Phase 1 mode)")
    yield


app = FastAPI(title="Flight Search API", lifespan=lifespan)

_allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

_IATA_RE = re.compile(r"^[A-Z]{3}$")
_ROUTE_RE = re.compile(r"^[A-Z]{3}-[A-Z]{3}$")


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    from fastapi.responses import JSONResponse

    retryable = not isinstance(exc, (ValueError, HTTPException))
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": str(exc), "retryable": retryable}},
    )


@app.get("/api/health")
async def health():
    amadeus_configured = bool(
        os.getenv("AMADEUS_API_KEY") and os.getenv("AMADEUS_API_SECRET")
    )
    db_ok: bool | None = None
    if os.getenv("SUPABASE_URL"):
        try:
            db = await db_client.get_client()
            db_ok = await repo.ping_db(db)
        except Exception:
            db_ok = False

    return {
        "status": "ok",
        "db": db_ok,
        "providers": {
            "fast_flights": {"reachable": True},
            "amadeus": {"reachable": amadeus_configured},
        },
    }


@app.get("/api/search")
async def search_flights(
    origin: str = Query(..., description="IATA origin airport code"),
    dest: str = Query(..., description="IATA destination airport code"),
    date: str = Query(..., description="Departure date YYYY-MM-DD"),
    adults: int = Query(default=1, ge=1, le=9),
    cabin: str = Query(default="economy"),
):
    if not _IATA_RE.match(origin):
        raise HTTPException(status_code=422, detail="origin must be 3 uppercase letters (e.g. TPE)")
    if not _IATA_RE.match(dest):
        raise HTTPException(status_code=422, detail="dest must be 3 uppercase letters (e.g. NRT)")

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    try:
        dep_date = DateType.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    if dep_date < DateType.today():
        raise HTTPException(status_code=422, detail="date must be today or in the future")

    valid_cabins = {"economy", "premium-economy", "business", "first"}
    if cabin not in valid_cabins:
        raise HTTPException(status_code=422, detail=f"cabin must be one of {sorted(valid_cabins)}")

    try:
        if _cached_search is not None:
            result = await _cached_search.search(origin, dest, date, adults, cabin)
        else:
            result = await _chain.search(origin, dest, date, adults, cabin)
    except AllProvidersFailed as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "ALL_PROVIDERS_FAILED", "message": str(exc), "retryable": True},
        )

    return result


@app.get("/api/history")
async def price_history(
    route: str = Query(..., description="Route in format AAA-BBB"),
    days: int = Query(default=90, ge=1, le=365),
):
    if not _ROUTE_RE.match(route):
        raise HTTPException(status_code=422, detail="route must be AAA-BBB format (e.g. TPE-NRT)")

    if _cached_search is None:
        raise HTTPException(status_code=503, detail="Database not configured")

    db = await db_client.get_client()
    data = await repo.get_price_history(db, route, days)
    return {"route": route, "days": days, "history": data}
