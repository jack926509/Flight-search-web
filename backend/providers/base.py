from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Flight(BaseModel):
    airline: str
    flight_no: str
    depart_time: str      # "HH:MM"
    arrive_time: str      # "HH:MM"
    duration_min: int
    stops: int
    price: int            # always in currency field's unit
    currency: str         # e.g. "TWD"
    original_currency: Optional[str] = None  # set when FX conversion applied
    booking_hint: str     # Google Flights search URL (search-page level, not deep link)


class SearchResult(BaseModel):
    flights: list[Flight]
    source: str
    fetched_at: datetime
    stale: bool = False


class FlightProvider(ABC):
    name: str

    @abstractmethod
    async def search(
        self,
        origin: str,
        dest: str,
        date: str,
        adults: int = 1,
        cabin: str = "economy",
    ) -> SearchResult:
        """Search flights. Raises on provider failure; empty flights list is NOT an error."""
        ...

    def is_available(self) -> bool:
        """Return False when throttled; search_chain skips unavailable providers."""
        return True

    def set_db(self, db) -> None:
        """Inject DB client after lifespan init for quota/throttle persistence."""
        pass
