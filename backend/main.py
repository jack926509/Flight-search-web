import os
import re
from datetime import date as DateType

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from providers.amadeus_provider import AmadeusProvider
from providers.fast_flights_provider import FastFlightsProvider
from services.search_chain import AllProvidersFailed, SearchChain

app = FastAPI(title="Flight Search API")

_allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

_fast_flights = FastFlightsProvider()
_amadeus = AmadeusProvider()
_chain = SearchChain([_fast_flights, _amadeus])

_IATA_RE = re.compile(r"^[A-Z]{3}$")


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: ErrorDetail


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
    return {
        "status": "ok",
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
    # Validate IATA codes (must already be uppercase)
    if not _IATA_RE.match(origin):
        raise HTTPException(status_code=422, detail="origin must be 3 uppercase letters (e.g. TPE)")
    if not _IATA_RE.match(dest):
        raise HTTPException(status_code=422, detail="dest must be 3 uppercase letters (e.g. NRT)")

    # Validate date — must be strict YYYY-MM-DD (fromisoformat also accepts YYYYMMDD in Py3.11+)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    try:
        dep_date = DateType.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    if dep_date < DateType.today():
        raise HTTPException(status_code=422, detail="date must be today or in the future")

    # Validate cabin
    valid_cabins = {"economy", "premium-economy", "business", "first"}
    if cabin not in valid_cabins:
        raise HTTPException(status_code=422, detail=f"cabin must be one of {sorted(valid_cabins)}")

    try:
        result = await _chain.search(origin, dest, date, adults, cabin)
    except AllProvidersFailed as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "ALL_PROVIDERS_FAILED", "message": str(exc), "retryable": True},
        )

    return result
