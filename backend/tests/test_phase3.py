"""Phase 3 integration tests: quota, API token, rate limit, scheduler idempotency."""
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


tomorrow = (date.today() + timedelta(days=1)).isoformat()


# ── Quota protection (90% soft limit) ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_amadeus_quota_exceeded_raises():
    from providers.amadeus_provider import AmadeusProvider, QuotaExceeded

    provider = AmadeusProvider()
    provider._api_key = "KEY"
    provider._api_secret = "SECRET"
    db = MagicMock()
    provider.set_db(db)

    with (
        patch("providers.amadeus_provider.repo.get_monthly_calls", new_callable=AsyncMock, return_value=1800),
        patch("providers.amadeus_provider.repo.increment_monthly_calls", new_callable=AsyncMock),
    ):
        with pytest.raises(QuotaExceeded):
            await provider.search("TPE", "NRT", tomorrow)


@pytest.mark.asyncio
async def test_amadeus_quota_increments_before_call():
    """G3: quota counter incremented BEFORE the API call."""
    from providers.amadeus_provider import AmadeusProvider

    provider = AmadeusProvider()
    provider._api_key = "KEY"
    provider._api_secret = "SECRET"
    provider._token = "tok"
    provider._token_expires_at = 9999999999.0

    db = MagicMock()
    provider.set_db(db)

    call_order: list[str] = []

    async def mock_get_calls(*a, **kw):
        call_order.append("get_monthly_calls")
        return 0

    async def mock_increment(*a, **kw):
        call_order.append("increment_monthly_calls")
        return 1

    import httpx
    from unittest.mock import AsyncMock as AM

    mock_resp = MagicMock()
    mock_resp.json.return_value = {"data": []}
    mock_resp.raise_for_status = MagicMock()

    with (
        patch("providers.amadeus_provider.repo.get_monthly_calls", side_effect=mock_get_calls),
        patch("providers.amadeus_provider.repo.increment_monthly_calls", side_effect=mock_increment),
        patch("providers.amadeus_provider.httpx.AsyncClient") as mock_cls,
    ):
        mock_client = AM()
        mock_client.__aenter__ = AM(return_value=mock_client)
        mock_client.__aexit__ = AM(return_value=None)
        mock_client.get = AM(return_value=mock_resp)
        mock_cls.return_value = mock_client

        await provider.search("TPE", "NRT", tomorrow)

    assert call_order.index("increment_monthly_calls") < call_order.index("increment_monthly_calls") + 1
    assert "get_monthly_calls" in call_order
    assert "increment_monthly_calls" in call_order


# ── API token middleware ───────────────────────────────────────────────────────

def test_api_token_missing_returns_403(monkeypatch):
    monkeypatch.setenv("API_TOKEN", "super-secret")

    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as tc:
        resp = tc.get(f"/api/search?origin=TPE&dest=NRT&date={tomorrow}")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"


def test_api_token_correct_passes(monkeypatch):
    monkeypatch.setenv("API_TOKEN", "super-secret")

    from fastapi.testclient import TestClient
    from main import app
    from services.search_chain import AllProvidersFailed

    with (
        patch("main._chain") as mock_chain,
        patch("main._cached_search", None),
        TestClient(app) as tc,
    ):
        mock_chain.search = AsyncMock(side_effect=AllProvidersFailed("no providers"))
        resp = tc.get(
            f"/api/search?origin=TPE&dest=NRT&date={tomorrow}",
            headers={"X-API-Token": "super-secret"},
        )
    # 503 means the token passed — providers just failed
    assert resp.status_code == 503


def test_api_health_exempt_from_token(monkeypatch):
    """Health endpoint should not require X-API-Token."""
    monkeypatch.setenv("API_TOKEN", "super-secret")

    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as tc:
        resp = tc.get("/api/health")
    assert resp.status_code == 200


# ── Rate limit ────────────────────────────────────────────────────────────────

def test_rate_limit_returns_429():
    """slowapi returns 429 when the per-IP limit is exceeded."""
    from fastapi import FastAPI, Request
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address
    from fastapi.testclient import TestClient

    lim = Limiter(key_func=get_remote_address)
    test_app = FastAPI()
    test_app.state.limiter = lim
    test_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @test_app.get("/ping")
    @lim.limit("1/minute")
    async def ping(request: Request):
        return {"pong": True}

    tc = TestClient(test_app)
    r1 = tc.get("/ping")
    assert r1.status_code == 200
    r2 = tc.get("/ping")
    assert r2.status_code == 429


# ── Scheduler idempotency ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scheduler_skips_when_history_exists():
    from services.scheduler import _fetch_route

    db = MagicMock()
    cached_search = MagicMock()
    cached_search.search = AsyncMock()

    with patch("services.scheduler.repo.has_history_today", new_callable=AsyncMock, return_value=True):
        await _fetch_route("TPE-NRT", cached_search, db)

    cached_search.search.assert_not_called()


@pytest.mark.asyncio
async def test_scheduler_fetches_when_no_history():
    from providers.base import SearchResult
    from services.scheduler import _fetch_route
    from datetime import datetime, timezone

    db = MagicMock()
    cached_search = MagicMock()
    fake_result = SearchResult(flights=[], source="fast_flights", fetched_at=datetime.now(timezone.utc))
    cached_search.search = AsyncMock(return_value=fake_result)

    with patch("services.scheduler.repo.has_history_today", new_callable=AsyncMock, return_value=False):
        await _fetch_route("TPE-NRT", cached_search, db)

    cached_search.search.assert_called_once()
