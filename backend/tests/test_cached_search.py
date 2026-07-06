"""Phase 2: cache hit / miss / stale scenarios (Supabase mocked)."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from providers.base import Flight, SearchResult
from services.cached_search import CachedSearch
from services.search_chain import AllProvidersFailed, SearchChain

_UTC = timezone.utc


def _flight(price: int = 8500) -> Flight:
    return Flight(
        airline="BR",
        flight_no="BR197",
        depart_time="08:00",
        arrive_time="12:30",
        duration_min=270,
        stops=0,
        price=price,
        currency="TWD",
        booking_hint="https://www.google.com/travel/flights/search?q=flights+from+TPE+to+NRT+on+2026-10-01",
    )


def _live_result(source: str = "fast_flights", price: int = 8500) -> SearchResult:
    return SearchResult(
        flights=[_flight(price)],
        source=source,
        fetched_at=datetime(2026, 10, 1, 1, 0, 0, tzinfo=_UTC),
    )


def _cached_payload(price: int = 8500, source: str = "fast_flights") -> dict:
    return {
        "payload": {
            "flights": [_flight(price).model_dump()],
            "source": source,
            "fetched_at": "2026-10-01T01:00:00+00:00",
            "stale": False,
        },
        "source": source,
        "created_at": "2026-10-01T01:00:00+00:00",
    }


# ── 1. Cache hit ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_hit_returns_source_cache():
    chain = MagicMock(spec=SearchChain)
    chain.search = AsyncMock()  # should NOT be called
    db = MagicMock()

    with patch("services.cached_search.repo.get_cached", new_callable=AsyncMock,
               return_value=_cached_payload()):
        cs = CachedSearch(chain, db)
        result = await cs.search("TPE", "NRT", "2026-10-01", 1, "economy")

    assert result.source == "cache"
    assert result.stale is False
    chain.search.assert_not_called()


# ── 2. Cache miss → live → write cache ───────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_miss_calls_chain_and_writes_cache():
    chain = MagicMock(spec=SearchChain)
    chain.search = AsyncMock(return_value=_live_result())
    db = MagicMock()

    with (
        patch("services.cached_search.repo.get_cached", new_callable=AsyncMock,
              return_value=None),
        patch("services.cached_search.repo.set_cache", new_callable=AsyncMock) as mock_set,
        patch("services.cached_search.repo.upsert_price_history", new_callable=AsyncMock) as mock_hist,
        patch("services.cached_search.repo.delete_old_cache", new_callable=AsyncMock),
    ):
        cs = CachedSearch(chain, db)
        result = await cs.search("TPE", "NRT", "2026-10-01", 1, "economy")

    assert result.source == "fast_flights"
    assert result.stale is False
    mock_set.assert_called_once()
    mock_hist.assert_called_once()  # baseline query → history written


@pytest.mark.asyncio
async def test_non_baseline_query_does_not_write_history():
    """Business cabin / multi-pax must NOT write price_history (G1)."""
    chain = MagicMock(spec=SearchChain)
    chain.search = AsyncMock(return_value=_live_result())
    db = MagicMock()

    with (
        patch("services.cached_search.repo.get_cached", new_callable=AsyncMock,
              return_value=None),
        patch("services.cached_search.repo.set_cache", new_callable=AsyncMock),
        patch("services.cached_search.repo.upsert_price_history", new_callable=AsyncMock) as mock_hist,
        patch("services.cached_search.repo.delete_old_cache", new_callable=AsyncMock),
    ):
        cs = CachedSearch(chain, db)
        # Business cabin
        await cs.search("TPE", "NRT", "2026-10-01", 1, "business")
        # Multi-pax economy
        await cs.search("TPE", "NRT", "2026-10-01", 2, "economy")

    mock_hist.assert_not_called()


@pytest.mark.asyncio
async def test_empty_flights_writes_cache_but_not_history():
    """Empty result is success (G2) — cache written, history NOT written (no flights)."""
    empty_result = SearchResult(flights=[], source="fast_flights",
                                fetched_at=datetime(2026, 10, 1, tzinfo=_UTC))
    chain = MagicMock(spec=SearchChain)
    chain.search = AsyncMock(return_value=empty_result)
    db = MagicMock()

    with (
        patch("services.cached_search.repo.get_cached", new_callable=AsyncMock,
              return_value=None),
        patch("services.cached_search.repo.set_cache", new_callable=AsyncMock) as mock_set,
        patch("services.cached_search.repo.upsert_price_history", new_callable=AsyncMock) as mock_hist,
        patch("services.cached_search.repo.delete_old_cache", new_callable=AsyncMock),
    ):
        cs = CachedSearch(chain, db)
        result = await cs.search("TPE", "XYZ", "2026-10-01", 1, "economy")

    assert result.flights == []
    mock_set.assert_called_once()   # empty result cached
    mock_hist.assert_not_called()   # no flights → no history


# ── 3. Stale fallback ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_fallback_when_all_providers_fail():
    chain = MagicMock(spec=SearchChain)
    chain.search = AsyncMock(side_effect=AllProvidersFailed("all down"))
    db = MagicMock()

    with (
        patch("services.cached_search.repo.get_cached", new_callable=AsyncMock,
              return_value=None),
        patch("services.cached_search.repo.get_stale_cached", new_callable=AsyncMock,
              return_value=_cached_payload()),
    ):
        cs = CachedSearch(chain, db)
        result = await cs.search("TPE", "NRT", "2026-10-01", 1, "economy")

    assert result.stale is True
    assert result.source == "fast_flights"
    assert len(result.flights) == 1


@pytest.mark.asyncio
async def test_raises_when_all_fail_and_no_stale():
    chain = MagicMock(spec=SearchChain)
    chain.search = AsyncMock(side_effect=AllProvidersFailed("all down"))
    db = MagicMock()

    with (
        patch("services.cached_search.repo.get_cached", new_callable=AsyncMock,
              return_value=None),
        patch("services.cached_search.repo.get_stale_cached", new_callable=AsyncMock,
              return_value=None),
    ):
        cs = CachedSearch(chain, db)
        with pytest.raises(AllProvidersFailed):
            await cs.search("TPE", "NRT", "2026-10-01", 1, "economy")
