import asyncio
import logging
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import date as DateType

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from db import client as db_client
from db import repository as repo
from db import tracker_repository as tracker_repo
from providers.fast_flights_provider import FastFlightsProvider
from providers.kiwi_provider import KiwiProvider
from services.cached_search import CachedSearch
from services.circuit_breaker import CircuitBreaker
from services.search_chain import AllProvidersFailed, SearchChain
from services.tracker_service import (
    TrackerKeyError,
    create_tracker_payload,
    generate_tracker_key,
    hash_tracker_key,
    lowest_price,
)

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
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*", "X-API-Token", "X-Tracker-Key"],
)

_IATA_RE = re.compile(r"^[A-Z]{3}$")
_ROUTE_RE = re.compile(r"^[A-Z]{3}-[A-Z]{3}$")
_SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class TrackerCreate(BaseModel):
    trip_type: str
    origin: str
    dest: str
    date: str
    return_date: str | None = None
    adults: int = 1
    cabin: str = "economy"
    target_price_twd: int | None = None


class TrackerPatch(BaseModel):
    target_price_twd: int | None = None
    enabled: bool | None = None
    mark_all_read: bool = False


def _validate_iata(value: str, field: str) -> None:
    if not _IATA_RE.match(value):
        raise HTTPException(status_code=422, detail=f"{field} must be 3 uppercase letters (e.g. TPE)")


def _validate_date(value: str, field: str) -> DateType:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")
    try:
        parsed = DateType.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")
    if parsed < DateType.today():
        raise HTTPException(status_code=422, detail=f"{field} must be today or in the future")
    return parsed


def _validate_cabin(value: str) -> None:
    valid_cabins = {"economy", "premium-economy", "business", "first"}
    if value not in valid_cabins:
        raise HTTPException(status_code=422, detail=f"cabin must be one of {sorted(valid_cabins)}")


def _tracker_hash_from_header(x_tracker_key: str | None) -> str:
    if not x_tracker_key:
        raise HTTPException(status_code=422, detail="X-Tracker-Key header is required")
    try:
        return hash_tracker_key(x_tracker_key)
    except TrackerKeyError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


async def _tracker_db():
    if _cached_search is None:
        raise HTTPException(status_code=503, detail="Database not configured")
    try:
        async with asyncio.timeout(8):
            return await db_client.get_client()
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")


_TRACKER_DB_TIMEOUT_S = 8
_TRACKER_DB_ERROR_DETAIL = "資料庫暫時無法使用，請稍後再試"


async def _tracker_op(coro):
    """對單一 tracker_repo 呼叫加硬性逾時；逾時或例外統一轉 503（比照 history 端點 main.py:421 附近寫法），
    避免 Supabase 查詢黑洞讓 tracker CRUD 請求永久掛住。"""
    try:
        async with asyncio.timeout(_TRACKER_DB_TIMEOUT_S):
            return await coro
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail=_TRACKER_DB_ERROR_DETAIL)


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


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    for key, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    return response


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
@_limiter.limit("40/minute")
async def search_flights(
    request: Request,
    origin: str = Query(..., description="IATA origin airport code"),
    dest: str = Query(..., description="IATA destination airport code"),
    date: str = Query(..., description="Departure date YYYY-MM-DD"),
    adults: int = Query(default=1, ge=1, le=9),
    cabin: str = Query(default="economy"),
):
    _validate_iata(origin, "origin")
    _validate_iata(dest, "dest")
    _validate_date(date, "date")
    _validate_cabin(cabin)

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


@app.post("/api/trackers")
@_limiter.limit("10/minute")
async def create_tracker(
    request: Request,
    payload: TrackerCreate,
    x_tracker_key: str | None = Header(default=None, alias="X-Tracker-Key"),
):
    _validate_iata(payload.origin, "origin")
    _validate_iata(payload.dest, "dest")
    dep_date = _validate_date(payload.date, "date")
    ret_date = _validate_date(payload.return_date, "return_date") if payload.return_date else None
    _validate_cabin(payload.cabin)
    if payload.trip_type not in {"one-way", "round-trip"}:
        raise HTTPException(status_code=422, detail="trip_type must be one-way or round-trip")
    if payload.trip_type == "one-way" and payload.return_date:
        raise HTTPException(status_code=422, detail="one-way tracker must not include return_date")
    if payload.trip_type == "round-trip" and not payload.return_date:
        raise HTTPException(status_code=422, detail="round-trip tracker requires return_date")
    if ret_date and ret_date < dep_date:
        raise HTTPException(status_code=422, detail="return_date must be after date")
    if payload.target_price_twd is not None and payload.target_price_twd <= 0:
        raise HTTPException(status_code=422, detail="target_price_twd must be greater than 0")

    raw_key = x_tracker_key or generate_tracker_key()
    try:
        tracker_key_hash = hash_tracker_key(raw_key)
    except TrackerKeyError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    db = await _tracker_db()
    current_price: int | None = None
    if _cached_search is not None:
        try:
            if payload.trip_type == "one-way":
                result = await _cached_search.search(payload.origin, payload.dest, payload.date, payload.adults, payload.cabin)
                current_price = lowest_price(result)
            else:
                outbound, inbound = await asyncio.gather(
                    _cached_search.search(payload.origin, payload.dest, payload.date, payload.adults, payload.cabin),
                    _cached_search.search(payload.dest, payload.origin, payload.return_date or "", payload.adults, payload.cabin),
                )
                out_price = lowest_price(outbound)
                in_price = lowest_price(inbound)
                current_price = out_price + in_price if out_price and in_price else None
        except Exception:
            current_price = None

    tracker = await _tracker_op(
        tracker_repo.create_tracker(
            db,
            create_tracker_payload(payload, tracker_key_hash, current_price),
        )
    )
    return {
        "tracker_key": raw_key if not x_tracker_key else None,
        "tracker": tracker,
        "events": [],
    }


@app.get("/api/trackers")
@_limiter.limit("20/minute")
async def list_trackers(
    request: Request,
    x_tracker_key: str | None = Header(default=None, alias="X-Tracker-Key"),
):
    tracker_key_hash = _tracker_hash_from_header(x_tracker_key)
    db = await _tracker_db()
    trackers = await _tracker_op(tracker_repo.list_trackers(db, tracker_key_hash))
    events = await _tracker_op(tracker_repo.list_events(db, tracker_key_hash))
    return {
        "trackers": trackers,
        "events": events,
        "unread_count": sum(1 for event in events if not event.get("read")),
    }


@app.patch("/api/trackers/{tracker_id}")
@_limiter.limit("20/minute")
async def update_tracker(
    request: Request,
    tracker_id: str,
    payload: TrackerPatch,
    x_tracker_key: str | None = Header(default=None, alias="X-Tracker-Key"),
):
    tracker_key_hash = _tracker_hash_from_header(x_tracker_key)
    db = await _tracker_db()

    changes: dict = {}
    if payload.target_price_twd is not None:
        if payload.target_price_twd <= 0:
            raise HTTPException(status_code=422, detail="target_price_twd must be greater than 0")
        changes["target_price_twd"] = payload.target_price_twd
    if payload.enabled is not None:
        changes["enabled"] = payload.enabled

    tracker = None
    if changes:
        tracker = await _tracker_op(tracker_repo.update_tracker(db, tracker_id, tracker_key_hash, changes))
        if tracker is None:
            raise HTTPException(status_code=404, detail="Tracker not found")
    else:
        tracker = await _tracker_op(tracker_repo.get_tracker_for_owner(db, tracker_id, tracker_key_hash))
        if tracker is None:
            raise HTTPException(status_code=404, detail="Tracker not found")

    if payload.mark_all_read:
        await _tracker_op(tracker_repo.mark_events_read(db, tracker_key_hash, tracker_id))

    events = await _tracker_op(tracker_repo.list_events(db, tracker_key_hash))
    return {
        "tracker": tracker,
        "events": events,
        "unread_count": sum(1 for event in events if not event.get("read")),
    }


@app.delete("/api/trackers/{tracker_id}")
@_limiter.limit("20/minute")
async def delete_tracker(
    request: Request,
    tracker_id: str,
    x_tracker_key: str | None = Header(default=None, alias="X-Tracker-Key"),
):
    tracker_key_hash = _tracker_hash_from_header(x_tracker_key)
    db = await _tracker_db()
    deleted = await _tracker_op(tracker_repo.delete_tracker(db, tracker_id, tracker_key_hash))
    if not deleted:
        raise HTTPException(status_code=404, detail="Tracker not found")
    return {"ok": True}


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

    # DB 故障（例外或掛住）回 503 而非 500／無限等待
    try:
        async with asyncio.timeout(8):
            db = await db_client.get_client()
            data = await repo.get_price_history(db, route, days)
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"route": route, "days": days, "history": data}
