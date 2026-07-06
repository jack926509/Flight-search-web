import logging

from providers.base import FlightProvider, SearchResult
from services.circuit_breaker import CircuitBreaker, CircuitBreakerOpen

logger = logging.getLogger(__name__)


class AllProvidersFailed(Exception):
    pass


class SearchChain:
    def __init__(
        self,
        providers: list[FlightProvider],
        circuit_breakers: dict[str, CircuitBreaker] | None = None,
    ) -> None:
        self._providers = providers
        self._circuit_breakers = circuit_breakers or {}

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
            if not provider.is_available():
                logger.info("search_chain: skipping throttled provider %s", provider.name)
                last_exc = RuntimeError(f"{provider.name} is throttled")
                continue

            cb = self._circuit_breakers.get(provider.name)
            try:
                if cb:
                    result = await cb.call(provider.search, origin, dest, date, adults, cabin)
                else:
                    result = await provider.search(origin, dest, date, adults, cabin)
                # Empty flights list is a valid successful result (G2), not a failure.
                return result
            except CircuitBreakerOpen as exc:
                logger.info(
                    "search_chain: provider=%s circuit_breaker=open_or_busy, skipping",
                    provider.name,
                )
                last_exc = exc
            except Exception as exc:
                logger.warning(
                    "search_chain: provider=%s failed: %s — trying next", provider.name, exc
                )
                last_exc = exc

        raise AllProvidersFailed(
            f"All providers failed. Last error: {last_exc}"
        ) from last_exc
