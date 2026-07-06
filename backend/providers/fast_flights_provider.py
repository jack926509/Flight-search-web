import asyncio
import logging
import os
import random
from datetime import datetime, timedelta

from fast_flights import FlightQuery, Passengers, create_query, get_flights
from fast_flights.exceptions import FlightsNotFound

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


def _parse_duration(first_dep, last_arr) -> int:
    """Compute trip duration in minutes from first departure to last arrival."""
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
        # Single-flight parse failure should not crash the whole query (G13)
        logger.warning("fast_flights: failed to parse one flight result: %s", exc)
        return None


class FastFlightsProvider(FlightProvider):
    name = "fast_flights"

    def __init__(self) -> None:
        self._proxy = os.getenv("HTTPS_PROXY") or None

    def _run_sync(self, origin: str, dest: str, date: str, adults: int, cabin: str):
        """Synchronous fetch — called via asyncio.to_thread."""
        seat = _CABIN_MAP.get(cabin, "economy")
        query = create_query(
            flights=[FlightQuery(date=date, from_airport=origin, to_airport=dest)],
            seat=seat,
            trip="one-way",
            passengers=Passengers(adults=adults),
            currency="TWD",
        )
        return get_flights(query, proxy=self._proxy), query

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

            # Blocking call wrapped in thread to avoid blocking event loop
            result, query = await asyncio.to_thread(
                self._run_sync, origin, dest, date, adults, cabin
            )

        flights = [f for r in result if (f := _to_flight(r, origin, dest, date))]
        return SearchResult(
            flights=flights,
            source=self.name,
            fetched_at=datetime.utcnow(),
        )
