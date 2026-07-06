from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)
tomorrow = (date.today() + timedelta(days=1)).isoformat()


# ── parameter validation ──────────────────────────────────────────────────────

def test_search_missing_required_params():
    resp = client.get("/api/search")
    assert resp.status_code == 422


def test_search_invalid_iata_lowercase():
    resp = client.get(f"/api/search?origin=tpe&dest=NRT&date={tomorrow}")
    assert resp.status_code == 422


def test_search_invalid_iata_too_long():
    resp = client.get(f"/api/search?origin=TPEX&dest=NRT&date={tomorrow}")
    assert resp.status_code == 422


def test_search_past_date():
    past = (date.today() - timedelta(days=1)).isoformat()
    resp = client.get(f"/api/search?origin=TPE&dest=NRT&date={past}")
    assert resp.status_code == 422


def test_search_invalid_date_format():
    resp = client.get("/api/search?origin=TPE&dest=NRT&date=20261001")
    assert resp.status_code == 422


def test_search_adults_out_of_range():
    resp = client.get(f"/api/search?origin=TPE&dest=NRT&date={tomorrow}&adults=10")
    assert resp.status_code == 422


def test_search_invalid_cabin():
    resp = client.get(f"/api/search?origin=TPE&dest=NRT&date={tomorrow}&cabin=luxury")
    assert resp.status_code == 422


# ── successful response shape ─────────────────────────────────────────────────

def test_search_returns_result_shape():
    from datetime import datetime
    from providers.base import SearchResult, Flight

    mock_result = SearchResult(
        flights=[
            Flight(
                airline="BR",
                flight_no="BR197",
                depart_time="08:00",
                arrive_time="12:30",
                duration_min=270,
                stops=0,
                price=8500,
                currency="TWD",
                booking_hint="https://www.google.com/travel/flights/search?q=flights+from+TPE+to+NRT+on+2026-10-01",
            )
        ],
        source="fast_flights",
        fetched_at=datetime.utcnow(),
    )

    with patch("main._chain.search", new_callable=AsyncMock, return_value=mock_result):
        resp = client.get(f"/api/search?origin=TPE&dest=NRT&date={tomorrow}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "fast_flights"
    assert isinstance(data["flights"], list)
    assert len(data["flights"]) == 1
    f = data["flights"][0]
    assert f["currency"] == "TWD"
    assert isinstance(f["price"], int)


# ── health endpoint ───────────────────────────────────────────────────────────

def test_health_ok():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "fast_flights" in data["providers"]
    assert "amadeus" in data["providers"]


# ── error handling ────────────────────────────────────────────────────────────

def test_all_providers_failed_returns_503():
    from services.search_chain import AllProvidersFailed

    with patch("main._chain.search", new_callable=AsyncMock,
               side_effect=AllProvidersFailed("all down")):
        resp = client.get(f"/api/search?origin=TPE&dest=NRT&date={tomorrow}")

    assert resp.status_code == 503


def test_empty_flights_is_success_not_error():
    """Empty result list = valid response (G2: empty ≠ failure)."""
    from datetime import datetime
    from providers.base import SearchResult

    empty_result = SearchResult(
        flights=[],
        source="fast_flights",
        fetched_at=datetime.utcnow(),
    )

    with patch("main._chain.search", new_callable=AsyncMock, return_value=empty_result):
        resp = client.get(f"/api/search?origin=TPE&dest=XYZ&date={tomorrow}")

    assert resp.status_code == 200
    assert resp.json()["flights"] == []
