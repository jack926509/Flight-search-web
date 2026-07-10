from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from providers.base import Flight, SearchResult

client = TestClient(app)
tomorrow = (date.today() + timedelta(days=1)).isoformat()
return_day = (date.today() + timedelta(days=7)).isoformat()


def _flight(price: int) -> Flight:
    return Flight(
        airline="BR",
        flight_no="BR198",
        depart_time="08:00",
        arrive_time="12:00",
        duration_min=240,
        stops=0,
        price=price,
        currency="TWD",
        booking_hint="https://www.google.com/travel/flights",
    )


def _result(price: int) -> SearchResult:
    return SearchResult(
        flights=[_flight(price)],
        source="fast_flights",
        fetched_at=datetime.now(timezone.utc),
    )


def test_create_tracker_generates_key_and_stores_only_hash():
    cached = MagicMock()
    cached.search = AsyncMock(return_value=_result(8800))
    db = MagicMock()
    stored_payload: dict = {}

    async def fake_create_tracker(_db, payload):
        stored_payload.update(payload)
        return {"id": "tracker-1", **payload}

    with (
        patch("main._cached_search", cached),
        patch("main.db_client.get_client", new_callable=AsyncMock, return_value=db),
        patch("main.tracker_repo.create_tracker", new=AsyncMock(side_effect=fake_create_tracker)),
    ):
        resp = client.post(
            "/api/trackers",
            json={
                "trip_type": "one-way",
                "origin": "TPE",
                "dest": "NRT",
                "date": tomorrow,
                "adults": 1,
                "cabin": "economy",
                "target_price_twd": 9000,
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["tracker_key"].startswith("trk_")
    assert stored_payload["tracker_key_hash"]
    assert body["tracker_key"] not in str(stored_payload)
    assert stored_payload["current_price_twd"] == 8800


def test_list_trackers_requires_tracker_key():
    with patch("main._cached_search", MagicMock()):
        resp = client.get("/api/trackers")
    assert resp.status_code == 422


def test_list_trackers_rejects_bad_tracker_key():
    with patch("main._cached_search", MagicMock()):
        resp = client.get("/api/trackers", headers={"X-Tracker-Key": "bad-key"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_tracker_target_price_creates_event_once():
    from services.tracker_service import check_tracker

    db = MagicMock()
    cached = MagicMock()
    cached.search = AsyncMock(return_value=_result(8800))
    tracker = {
        "id": "tracker-1",
        "tracker_key_hash": "hash",
        "trip_type": "one-way",
        "origin": "TPE",
        "dest": "NRT",
        "depart_date": tomorrow,
        "return_date": None,
        "adults": 1,
        "cabin": "economy",
        "target_price_twd": 9000,
        "current_price_twd": 9500,
        "enabled": True,
    }

    with (
        patch("services.tracker_service.tracker_repo.create_event_once", new_callable=AsyncMock) as mock_event,
        patch("services.tracker_service.tracker_repo.set_tracker_price", new_callable=AsyncMock) as mock_price,
    ):
        price = await check_tracker(db, cached, tracker)

    assert price == 8800
    mock_event.assert_any_await(
        db,
        {
            "tracker_id": "tracker-1",
            "tracker_key_hash": "hash",
            "event_type": "target_price",
            "price_twd": 8800,
            "previous_price_twd": 9500,
            "target_price_twd": 9000,
            "message": f"TPE → NRT {tomorrow} 已低於目標價：NT$ 8,800",
        },
    )
    mock_price.assert_awaited_once_with(db, "tracker-1", 9500, 8800)


@pytest.mark.asyncio
async def test_round_trip_tracker_uses_combined_price():
    from services.tracker_service import check_tracker

    db = MagicMock()
    cached = MagicMock()
    cached.search = AsyncMock(side_effect=[_result(12000), _result(13000)])
    tracker = {
        "id": "tracker-2",
        "tracker_key_hash": "hash",
        "trip_type": "round-trip",
        "origin": "TPE",
        "dest": "NRT",
        "depart_date": tomorrow,
        "return_date": return_day,
        "adults": 1,
        "cabin": "economy",
        "target_price_twd": 26000,
        "current_price_twd": 28000,
        "enabled": True,
    }

    with (
        patch("services.tracker_service.tracker_repo.create_event_once", new_callable=AsyncMock) as mock_event,
        patch("services.tracker_service.tracker_repo.set_tracker_price", new_callable=AsyncMock),
    ):
        price = await check_tracker(db, cached, tracker)

    assert price == 25000
    assert cached.search.await_count == 2
    assert mock_event.await_count >= 1


@pytest.mark.asyncio
async def test_disabled_tracker_is_not_checked():
    from services.tracker_service import check_tracker

    cached = MagicMock()
    cached.search = AsyncMock()
    tracker = {"enabled": False}

    price = await check_tracker(MagicMock(), cached, tracker)

    assert price is None
    cached.search.assert_not_called()
