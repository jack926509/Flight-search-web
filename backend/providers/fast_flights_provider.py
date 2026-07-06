import asyncio
import logging
import os
import random
from datetime import datetime, timedelta

from fast_flights import FlightQuery, Passengers, create_query, get_flights
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from .base import Flight, FlightProvider, SearchResult

logger = logging.getLogger(__name__)

_SEMAPHORE = asyncio.Semaphore(1)

_CABIN_MAP = {
    "economy": "economy",
    "premium-economy": "premium-economy",
    "business": "business",
    "first": "first",
}

_BLOCK_SIGNALS = ("captcha", "unusual traffic", "too many requests")


def _is_retryable_ff(exc: BaseException) -> bool:
    """Block-signal errors are not retried; everything else is."""
    msg = str(exc).lower()
    return not any(s in msg for s in _BLOCK_SIGNALS)


def _parse_duration(first_dep, last_arr) -> int:
    dep = datetime(
        first_dep.date[0], first_dep.date[1], first_dep.date[2],
        first_dep.time[0], first_dep.time[1],
    )
    arr = datetime(
        last_arr.date[0], last_arr.date[1], last_arr.date[2],
        last_arr.time[0], last_arr.time[1],
    )
    if arr < dep:
        arr += timedelta(days=1)
    return int((arr - dep).total_seconds() // 60)


def _booking_url(origin: str, dest: str, date: str) -> str:
    return f"https://www.google.com/travel/flights/search?q=flights+from+{origin}+to+{dest}+on+{date}"


def _to_flight(ff_flight, origin: str, dest: str, date: str) -> Flight | None:
    try:
        segs = ff_flight.flights
        first_seg = segs[0]
        last_seg = segs[-1]
        dep_time = f"{first_seg.departure.time[0]:02d}:{first_seg.departure.time[1]:02d}"
        arr_time = f"{last_seg.arrival.time[0]:02d}:{last_seg.arrival.time[1]:02d}"
        duration = _parse_duration(first_seg.departure, last_seg.arrival)
        airline = ff_flight.airlines[0] if ff_flight.airlines else "Unknown"
        return Flight(
            airline=airline,
            flight_no="",
            depart_time=dep_time,
            arrive_time=arr_time,
            duration_min=duration,
            stops=len(segs) - 1,
            price=ff_flight.price,
            currency="TWD",
            booking_hint=_booking_url(origin, dest, date),
        )
    except Exception as exc:
        logger.warning("fast_flights: failed to parse one flight result: %s", exc)
        return None


class FastFlightsProvider(FlightProvider):
    name = "fast_flights"

    def __init__(self) -> None:
        self._proxy = os.getenv("HTTPS_PROXY") or None
        self._throttled: bool = False
        self._db = None

    def set_db(self, db) -> None:
        self._db = db

    def is_available(self) -> bool:
        return not self._throttled

    def _run_sync(self, origin: str, dest: str, date: str, adults: int, cabin: str):
        seat = _CABIN_MAP.get(cabin, "economy")
        query = create_query(
            flights=[FlightQuery(date=date, from_airport=origin, to_airport=dest)],
            seat=seat,
            trip="one-way",
            passengers=Passengers(adults=adults),
            currency="TWD",
        )
        return get_flights(query, proxy=self._proxy), query

    async def _fetch_with_retry(self, origin: str, dest: str, date: str, adults: int, cabin: str):
        """Run sync fetch in thread with tenacity retry (×2 for non-block errors)."""
        async for attempt in AsyncRetrying(
            retry=retry_if_exception(_is_retryable_ff),
            wait=wait_exponential(multiplier=1, min=1, max=2),
            stop=stop_after_attempt(3),
            reraise=True,
        ):
            with attempt:
                return await asyncio.to_thread(self._run_sync, origin, dest, date, adults, cabin)

    async def _persist_throttle(self) -> None:
        if self._db is None:
            return
        try:
            from datetime import timezone
            await self._db.table("provider_status").upsert(
                {
                    "provider": self.name,
                    "throttled": True,
                    "throttled_until": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
                },
                on_conflict="provider",
            ).execute()
        except Exception as exc:
            logger.warning("fast_flights: throttle persist failed (non-fatal): %s", exc)

    async def search(
        self,
        origin: str,
        dest: str,
        date: str,
        adults: int = 1,
        cabin: str = "economy",
    ) -> SearchResult:
        async with _SEMAPHORE:
            jitter = random.uniform(3.0, 6.0)
            await asyncio.sleep(jitter)

            try:
                result, _ = await self._fetch_with_retry(origin, dest, date, adults, cabin)
            except Exception as exc:
                msg = str(exc).lower()
                if any(s in msg for s in _BLOCK_SIGNALS):
                    self._throttled = True
                    logger.warning(
                        "fast_flights throttled — block signal detected: %s", exc
                    )
                    await self._persist_throttle()
                raise

        flights = [f for r in result if (f := _to_flight(r, origin, dest, date))]
        return SearchResult(
            flights=flights,
            source=self.name,
            fetched_at=datetime.utcnow(),
        )
