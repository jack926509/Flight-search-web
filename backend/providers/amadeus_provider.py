import logging
import os
import re
import time
from datetime import datetime

import httpx

from .base import Flight, FlightProvider, SearchResult

logger = logging.getLogger(__name__)

_CABIN_MAP = {
    "economy": "ECONOMY",
    "premium-economy": "PREMIUM_ECONOMY",
    "business": "BUSINESS",
    "first": "FIRST",
}

_ISO_DURATION_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?")


def _parse_iso_duration(iso: str) -> int:
    m = _ISO_DURATION_RE.match(iso)
    if not m:
        return 0
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    return hours * 60 + minutes


def _booking_url(origin: str, dest: str, date: str) -> str:
    return f"https://www.google.com/travel/flights/search?q=flights+from+{origin}+to+{dest}+on+{date}"


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

        async with httpx.AsyncClient() as client:
            token = await self._get_token(client)
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

                dep_time = first_seg["departure"]["at"][11:16]  # "HH:MM"
                arr_time = last_seg["arrival"]["at"][11:16]
                duration_min = _parse_iso_duration(itinerary["duration"])
                carrier = first_seg["carrierCode"]
                flight_no = f"{carrier}{first_seg['number']}"
                price_twd = round(float(offer["price"]["total"]))
                stops = len(segments) - 1

                flights.append(Flight(
                    airline=carrier,
                    flight_no=flight_no,
                    depart_time=dep_time,
                    arrive_time=arr_time,
                    duration_min=duration_min,
                    stops=stops,
                    price=price_twd,
                    currency="TWD",
                    booking_hint=_booking_url(origin, dest, date),
                ))
            except Exception as exc:
                logger.warning("amadeus: failed to parse one offer: %s", exc)

        return SearchResult(
            flights=flights,
            source=self.name,
            fetched_at=datetime.utcnow(),
        )
