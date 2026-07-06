import logging
import os
import re
import time
from datetime import datetime, timezone

import httpx
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from db import repository as repo
from .base import Flight, FlightProvider, SearchResult

logger = logging.getLogger(__name__)

_CABIN_MAP = {
    "economy": "ECONOMY",
    "premium-economy": "PREMIUM_ECONOMY",
    "business": "BUSINESS",
    "first": "FIRST",
}

_ISO_DURATION_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?")

_AMADEUS_MONTHLY_LIMIT = int(os.getenv("AMADEUS_MONTHLY_LIMIT", "2000"))
_AMADEUS_SOFT_LIMIT = int(_AMADEUS_MONTHLY_LIMIT * 0.9)  # 90% threshold


class QuotaExceeded(Exception):
    """Raised when Amadeus monthly quota soft limit (90%) is reached."""


def _parse_iso_duration(iso: str) -> int:
    m = _ISO_DURATION_RE.match(iso)
    if not m:
        return 0
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def _booking_url(origin: str, dest: str, date: str) -> str:
    return f"https://www.google.com/travel/flights/search?q=flights+from+{origin}+to+{dest}+on+{date}"


def _is_retryable_amadeus(exc: BaseException) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


class AmadeusProvider(FlightProvider):
    name = "amadeus"

    def __init__(self) -> None:
        self._api_key = os.getenv("AMADEUS_API_KEY", "")
        self._api_secret = os.getenv("AMADEUS_API_SECRET", "")
        env = os.getenv("AMADEUS_ENV", "test")
        self._base_url = (
            "https://api.amadeus.com"
            if env == "production"
            else "https://test.api.amadeus.com"
        )
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._db = None

    def set_db(self, db) -> None:
        self._db = db

    @staticmethod
    def _month_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m")

    async def _check_and_increment_quota(self) -> None:
        """G3: check quota BEFORE API call; increment BEFORE call so failed calls count."""
        if self._db is None:
            return
        month_key = self._month_key()
        try:
            current = await repo.get_monthly_calls(self._db, self.name, month_key)
            if current >= _AMADEUS_SOFT_LIMIT:
                raise QuotaExceeded(
                    f"amadeus quota soft limit reached ({current}/{_AMADEUS_SOFT_LIMIT})"
                )
            await repo.increment_monthly_calls(self._db, self.name, month_key)
        except QuotaExceeded:
            raise
        except Exception as exc:
            logger.warning("amadeus: quota check failed (non-fatal): %s", exc)

    async def _get_token(self, client: httpx.AsyncClient) -> str:
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token

        resp = await client.post(
            f"{self._base_url}/v1/security/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self._api_key,
                "client_secret": self._api_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expires_at = time.time() + data.get("expires_in", 1799)
        return self._token

    async def _do_search(
        self,
        client: httpx.AsyncClient,
        token: str,
        origin: str,
        dest: str,
        date: str,
        adults: int,
        cabin: str,
    ) -> list[Flight]:
        resp = await client.get(
            f"{self._base_url}/v2/shopping/flight-offers",
            params={
                "originLocationCode": origin,
                "destinationLocationCode": dest,
                "departureDate": date,
                "adults": adults,
                "travelClass": _CABIN_MAP.get(cabin, "ECONOMY"),
                "currencyCode": "TWD",
                "max": 20,
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        flights: list[Flight] = []
        for offer in data.get("data", []):
            try:
                itinerary = offer["itineraries"][0]
                segments = itinerary["segments"]
                first_seg = segments[0]
                last_seg = segments[-1]
                flights.append(Flight(
                    airline=first_seg["carrierCode"],
                    flight_no=f"{first_seg['carrierCode']}{first_seg['number']}",
                    depart_time=first_seg["departure"]["at"][11:16],
                    arrive_time=last_seg["arrival"]["at"][11:16],
                    duration_min=_parse_iso_duration(itinerary["duration"]),
                    stops=len(segments) - 1,
                    price=round(float(offer["price"]["total"])),
                    currency="TWD",
                    booking_hint=_booking_url(origin, dest, date),
                ))
            except Exception as exc:
                logger.warning("amadeus: failed to parse one offer: %s", exc)
        return flights

    async def search(
        self,
        origin: str,
        dest: str,
        date: str,
        adults: int = 1,
        cabin: str = "economy",
    ) -> SearchResult:
        if not self._api_key or not self._api_secret:
            raise RuntimeError("Amadeus credentials not configured")

        # G3: check+increment quota BEFORE the API call
        await self._check_and_increment_quota()

        async with httpx.AsyncClient() as client:
            token = await self._get_token(client)

            async for attempt in AsyncRetrying(
                retry=retry_if_exception(_is_retryable_amadeus),
                wait=wait_exponential(multiplier=1, min=1, max=2),
                stop=stop_after_attempt(3),
                reraise=True,
            ):
                with attempt:
                    flights = await self._do_search(client, token, origin, dest, date, adults, cabin)

        return SearchResult(
            flights=flights,
            source=self.name,
            fetched_at=datetime.utcnow(),
        )
