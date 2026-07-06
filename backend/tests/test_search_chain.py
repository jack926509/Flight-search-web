"""SearchChain failover logic."""
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from providers.base import SearchResult
from services.search_chain import AllProvidersFailed, SearchChain


def _make_result(source: str) -> SearchResult:
    return SearchResult(flights=[], source=source, fetched_at=datetime.utcnow())


@pytest.mark.asyncio
async def test_chain_uses_first_provider_on_success():
    p1 = MagicMock()
    p1.name = "p1"
    p1.search = AsyncMock(return_value=_make_result("p1"))
    p2 = MagicMock()
    p2.name = "p2"
    p2.search = AsyncMock(return_value=_make_result("p2"))

    chain = SearchChain([p1, p2])
    result = await chain.search("TPE", "NRT", "2026-10-01")

    assert result.source == "p1"
    p2.search.assert_not_called()


@pytest.mark.asyncio
async def test_chain_failover_when_first_raises():
    p1 = MagicMock()
    p1.name = "p1"
    p1.search = AsyncMock(side_effect=RuntimeError("network error"))
    p2 = MagicMock()
    p2.name = "p2"
    p2.search = AsyncMock(return_value=_make_result("p2"))

    chain = SearchChain([p1, p2])
    result = await chain.search("TPE", "NRT", "2026-10-01")

    assert result.source == "p2"


@pytest.mark.asyncio
async def test_chain_raises_when_all_fail():
    p1 = MagicMock()
    p1.name = "p1"
    p1.search = AsyncMock(side_effect=RuntimeError("p1 down"))
    p2 = MagicMock()
    p2.name = "p2"
    p2.search = AsyncMock(side_effect=RuntimeError("p2 down"))

    chain = SearchChain([p1, p2])

    with pytest.raises(AllProvidersFailed):
        await chain.search("TPE", "NRT", "2026-10-01")


@pytest.mark.asyncio
async def test_chain_empty_result_is_not_failover():
    """Empty flights list = success, second provider NOT tried (G2)."""
    p1 = MagicMock()
    p1.name = "p1"
    p1.search = AsyncMock(return_value=_make_result("p1"))  # 0 flights
    p2 = MagicMock()
    p2.name = "p2"
    p2.search = AsyncMock(return_value=_make_result("p2"))

    chain = SearchChain([p1, p2])
    result = await chain.search("TPE", "XYZ", "2026-10-01")

    assert result.source == "p1"
    p2.search.assert_not_called()
