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


def test_station_scan_rejects_more_than_seven_days_before_creating_job():
    resp = client.post(
        "/api/station-scans",
        json={
            "dest": "NRT",
            "from_date": tomorrow,
            "to_date": (date.today() + timedelta(days=9)).isoformat(),
            "stations": ["BKK"],
            "adults": 1,
            "cabin": "economy",
        },
    )
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
    assert "kiwi" in data["providers"]


def test_health_reports_persisted_provider_and_scheduler_status(monkeypatch):
    """健康端點必須回傳近期真實狀態，而非固定宣稱 provider 可用。"""
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    provider_status = {
        "fast_flights": {
            "state": "open",
            "failure_count": 3,
            "last_success_at": "2026-07-12T01:00:00+00:00",
            "last_failure_at": "2026-07-12T02:00:00+00:00",
            "last_error": "upstream timeout",
            "throttled": False,
        },
        "kiwi": {
            "state": "closed",
            "failure_count": 0,
            "last_success_at": "2026-07-12T02:10:00+00:00",
            "last_failure_at": None,
            "last_error": None,
            "throttled": False,
        },
    }
    scheduler_status = {
        "daily_price_fetch": {"last_status": "success", "last_finished_at": "2026-07-12T01:00:00+00:00"},
        "daily_tracker_check": {"last_status": "failed", "last_finished_at": "2026-07-12T02:00:00+00:00"},
    }

    with (
        patch("main.db_client.get_client", new_callable=AsyncMock, return_value=object()),
        patch("main.repo.ping_db", new_callable=AsyncMock, return_value=True),
        patch("main.repo.get_provider_health", new_callable=AsyncMock, return_value=provider_status),
        patch("main.repo.get_scheduler_health", new_callable=AsyncMock, return_value=scheduler_status),
    ):
        resp = client.get("/api/health")

    assert resp.status_code == 200
    data = resp.json()
    assert data["providers"]["fast_flights"]["reachable"] is False
    assert data["providers"]["fast_flights"]["last_failure_at"] == "2026-07-12T02:00:00+00:00"
    assert data["providers"]["fast_flights"]["last_error"] == "upstream timeout"
    assert data["providers"]["kiwi"]["reachable"] is True
    assert data["schedulers"]["daily_tracker_check"]["last_status"] == "failed"


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
