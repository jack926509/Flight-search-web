import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import date as DateType

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from db import client as db_client
from db import repository as repo
from providers.fast_flights_provider import FastFlightsProvider
from providers.kiwi_provider import KiwiProvider
from services.cached_search import CachedSearch
from services.circuit_breaker import CircuitBreaker
from services.search_chain import AllProvidersFailed, SearchChain

logger = logging.getLogger(__name__)

_fast_flights = FastFlightsProvider()
_kiwi = KiwiProvider()
_chain = SearchChain([_fast_flights, _kiwi])
_cached_search: CachedSearch | None = None
_circuit_breakers: dict[str, CircuitBreaker] = {}
_scheduler = None

_limiter = Limiter(key_func=get_remote_address, default_limits=["20/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cached_search, _circuit_breakers, _chain, _scheduler

    if os.getenv("SUPABASE_URL"):
        db = await db_client.get_client()

        # Init circuit breakers (E6: load persisted state)
        ff_cb = CircuitBreaker("fast_flights")
        kiwi_cb = CircuitBreaker("kiwi")
        ff_cb.set_db(db)
        kiwi_cb.set_db(db)
        await ff_cb.load_from_db()
        await kiwi_cb.load_from_db()
        _circuit_breakers = {"fast_flights": ff_cb, "kiwi": kiwi_cb}

        # Give providers DB access for quota and throttle tracking
        _fast_flights.set_db(db)
        _kiwi.set_db(db)
        await _fast_flights.load_from_db()  # restore throttle state after restart

        _chain = SearchChain([_fast_flights, _kiwi], circuit_breakers=_circuit_breakers)
        _cached_search = CachedSearch(_chain, db)

        # Start daily price scheduler
        from services.scheduler import create_scheduler
        _scheduler = create_scheduler(_cached_search, db)
        _scheduler.start()
        logger.info("CachedSearch + CircuitBreakers + Scheduler ready")
    else:
        logger.warning("SUPABASE_URL not set — running without cache (Phase 1 mode)")

    yield

    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)


app = FastAPI(title="Flight Search API", lifespan=lifespan)
app.state.limiter = _limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*", "X-API-Token"],
)

_IATA_RE = re.compile(r"^[A-Z]{3}$")
_ROUTE_RE = re.compile(r"^[A-Z]{3}-[A-Z]{3}$")


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


@app.middleware("http")
async def api_token_middleware(request: Request, call_next):
    required_token = os.getenv("API_TOKEN", "")
    # CORS preflight (OPTIONS) 依規範不帶自訂標頭，必須放行給 CORSMiddleware 回應；
    # /api/health is exempt so monitoring services don't need a token
    if request.method == "OPTIONS":
        return await call_next(request)
    if required_token and request.url.path.startswith("/api/") and request.url.path != "/api/health":
        provided = request.headers.get("X-API-Token", "")
        if not secrets.compare_digest(provided, required_token):
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "Invalid or missing X-API-Token header",
                        "retryable": False,
                    }
                },
            )
    return await call_next(request)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    # Log details server-side; never leak internal error strings to clients
    logger.exception("unhandled error on %s: %s", request.url.path, exc)
    retryable = not isinstance(exc, (ValueError, HTTPException))
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "retryable": retryable,
            }
        },
    )


@app.get("/api/health")
async def health():
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
            "fast_flights": {
                "reachable": True,
                "throttled": _fast_flights._throttled,
            },
            # Kiwi MCP 免金鑰，無「未設定」狀態；實際可達性由熔斷器狀態反映
            "kiwi": {"reachable": True},
        },
        "circuit_breakers": {
            name: cb.current_state() for name, cb in _circuit_breakers.items()
        },
    }


@app.get("/api/search")
@_limiter.limit("20/minute")
async def search_flights(
    request: Request,
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
@_limiter.limit("20/minute")
async def price_history(
    request: Request,
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
