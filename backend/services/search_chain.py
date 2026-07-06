import logging

from providers.base import FlightProvider, SearchResult

logger = logging.getLogger(__name__)


class AllProvidersFailed(Exception):
    pass


class SearchChain:
    def __init__(self, providers: list[FlightProvider]) -> None:
        self._providers = providers

    async def search(
        self,
        origin: str,
        dest: str,
        date: str,
        adults: int = 1,
        cabin: str = "economy",
    ) -> SearchResult:
        last_exc: Exception | None = None
        for provider in self._providers:
            try:
                result = await provider.search(origin, dest, date, adults, cabin)
                # Empty flights list is a valid successful result (G2), not a failure.
                return result
            except Exception as exc:
                logger.warning(
                    "Provider %s failed: %s — trying next", provider.name, exc
                )
                last_exc = exc

        raise AllProvidersFailed(
            f"All providers failed. Last error: {last_exc}"
        ) from last_exc
