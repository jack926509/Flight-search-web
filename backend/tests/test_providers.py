"""Provider-level tests: response mapping + currency conversion stubs."""
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest


# ── FastFlightsProvider ────────────────────────────────────────────────────────

def _make_ff_result(price: int = 8500, airlines: list[str] | None = None):
    """Build a minimal fast-flights Flights mock."""
    seg = MagicMock()
    seg.departure.date = (2026, 10, 1)
    seg.departure.time = (8, 0)
    seg.arrival.date = (2026, 10, 1)
    seg.arrival.time = (12, 30)
    seg.duration = 270

    flights_obj = MagicMock()
    flights_obj.price = price
    flights_obj.airlines = airlines or ["BR"]
    flights_obj.flights = [seg]
    return flights_obj


@pytest.mark.asyncio
async def test_fast_flights_maps_to_twd():
    from providers.fast_flights_provider import FastFlightsProvider

    mock_result = [_make_ff_result()]

    provider = FastFlightsProvider()
    with (
        patch.object(provider, "_run_sync", return_value=(mock_result, MagicMock())),
        patch("providers.fast_flights_provider._SEMAPHORE", new=__import__("asyncio").Semaphore(1)),
    ):
        result = await provider.search("TPE", "NRT", "2026-10-01")

    assert result.source == "fast_flights"
    assert result.flights[0].currency == "TWD"
    assert result.flights[0].price == 8500
    assert result.flights[0].stops == 0


def test_fast_flights_single_parse_failure_does_not_crash():
    """A flight that fails to parse is skipped; others still returned (G13)."""
    from providers.fast_flights_provider import FastFlightsProvider, _to_flight

    bad = MagicMock()
    bad.flights = []  # will fail _parse_duration (IndexError)
    bad.price = 1000
    bad.airlines = ["XX"]

    # _to_flight returns None on error
    result = _to_flight(bad, "TPE", "NRT", "2026-10-01")
    assert result is None


# ── AmadeusProvider ────────────────────────────────────────────────────────────

def _make_amadeus_response():
    return {
        "data": [
            {
                "itineraries": [
                    {
                        "duration": "PT4H30M",
                        "segments": [
                            {
                                "departure": {"iataCode": "TPE", "at": "2026-10-01T08:00:00"},
                                "arrival": {"iataCode": "NRT", "at": "2026-10-01T12:30:00"},
                                "carrierCode": "BR",
                                "number": "197",
                                "numberOfStops": 0,
                            }
                        ],
                    }
                ],
                "price": {"total": "12500.00", "currency": "TWD"},
            }
        ]
    }


@pytest.mark.asyncio
async def test_amadeus_maps_correctly():
    import httpx
    from unittest.mock import AsyncMock
    from providers.amadeus_provider import AmadeusProvider

    provider = AmadeusProvider()
    provider._api_key = "KEY"
    provider._api_secret = "SECRET"
    provider._token = "tok"
    provider._token_expires_at = 9999999999.0

    mock_resp = MagicMock()
    mock_resp.json.return_value = _make_amadeus_response()
    mock_resp.raise_for_status = MagicMock()

    with patch("providers.amadeus_provider.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await provider.search("TPE", "NRT", "2026-10-01")

    assert result.source == "amadeus"
    assert len(result.flights) == 1
    f = result.flights[0]
    assert f.flight_no == "BR197"
    assert f.duration_min == 270
    assert f.currency == "TWD"
    assert f.price == 12500
    assert f.stops == 0


@pytest.mark.asyncio
async def test_amadeus_unconfigured_raises():
    import os
    from providers.amadeus_provider import AmadeusProvider

    provider = AmadeusProvider()
    provider._api_key = ""
    provider._api_secret = ""

    with pytest.raises(RuntimeError, match="credentials"):
        await provider.search("TPE", "NRT", "2026-10-01")


@pytest.mark.asyncio
async def test_amadeus_usd_offer_converted_with_fx_fallback():
    """FX 兜底：test 環境回 USD 時以 FX_USD_TWD 換算並標 original_currency。"""
    from unittest.mock import AsyncMock
    from providers.amadeus_provider import AmadeusProvider

    provider = AmadeusProvider()
    provider._api_key = "KEY"
    provider._api_secret = "SECRET"
    provider._token = "tok"
    provider._token_expires_at = 9999999999.0

    body = _make_amadeus_response()
    body["data"][0]["price"] = {"total": "400.00", "currency": "USD"}

    mock_resp = MagicMock()
    mock_resp.json.return_value = body
    mock_resp.raise_for_status = MagicMock()

    with patch("providers.amadeus_provider.httpx.AsyncClient") as mock_client_cls, \
         patch("providers.amadeus_provider._FX_USD_TWD", 32.0):
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await provider.search("TPE", "NRT", "2026-10-01")

    assert len(result.flights) == 1
    f = result.flights[0]
    assert f.currency == "TWD"
    assert f.original_currency == "USD"
    assert f.price == 12800  # 400 * 32.0
