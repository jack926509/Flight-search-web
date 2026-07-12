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


# ── KiwiProvider ───────────────────────────────────────────────────────────────

def _make_kiwi_payload(price: int = 5009, currency: str = "TWD"):
    """Sample payload matching the real Kiwi MCP search-flight response shape."""
    return {
        "query": "TPE → NRT on 05/08/2026, 1 adult",
        "currency": currency,
        "resultsCount": 1,
        "itineraries": [
            {
                "price": price,
                "priceFormatted": f"{price} {currency}",
                "totalDurationSeconds": 12600,
                "bookingUrl": "https://kiwi.com/u/7f7vs5",
                "outbound": {
                    "from": "TPE",
                    "to": "NRT",
                    "departureTime": "2026-08-05T02:00:00",
                    "arrivalTime": "2026-08-05T06:30:00",
                    "durationSeconds": 12600,
                    "stops": 0,
                    "route": ["TPE", "NRT"],
                    "cabinClass": "Economy",
                    "segments": [
                        {
                            "from": "TPE",
                            "to": "NRT",
                            "departureTime": "2026-08-05T02:00:00",
                            "arrivalTime": "2026-08-05T06:30:00",
                            "durationSeconds": 12600,
                            "carrier": "MM",
                            "flightNumber": "MM620",
                            "cabinClass": "Economy",
                        }
                    ],
                },
                "inbound": None,
            }
        ],
    }


@pytest.mark.asyncio
async def test_kiwi_maps_correctly():
    from unittest.mock import AsyncMock
    from providers.kiwi_provider import KiwiProvider

    provider = KiwiProvider()
    with patch.object(
        provider, "_call_mcp", new=AsyncMock(return_value=_make_kiwi_payload())
    ) as mock_call:
        result = await provider.search("TPE", "NRT", "2026-08-05")

    assert result.source == "kiwi"
    assert len(result.flights) == 1
    f = result.flights[0]
    assert f.airline == "MM"
    assert f.flight_no == "MM620"
    assert f.depart_time == "02:00"
    assert f.arrive_time == "06:30"
    assert f.duration_min == 210
    assert f.currency == "TWD"
    assert f.price == 5009
    assert f.stops == 0

    # 日期轉為 Kiwi 的 DD/MM/YYYY、幣別鎖 TWD、艙等映射 economy→M
    args = mock_call.call_args.args[0]
    assert args["departureDate"] == "05/08/2026"
    assert args["currency"] == "TWD"
    assert args["cabinClass"] == "M"


@pytest.mark.asyncio
async def test_kiwi_usd_payload_converted_with_fx_fallback():
    """FX 兜底：回 USD 時以 FX_USD_TWD 換算並標 original_currency。"""
    from unittest.mock import AsyncMock
    from providers.kiwi_provider import KiwiProvider

    provider = KiwiProvider()
    payload = _make_kiwi_payload(price=400, currency="USD")

    with patch.object(provider, "_call_mcp", new=AsyncMock(return_value=payload)), \
         patch("providers.kiwi_provider._FX_USD_TWD", 32.0):
        result = await provider.search("TPE", "NRT", "2026-08-05")

    assert len(result.flights) == 1
    f = result.flights[0]
    assert f.currency == "TWD"
    assert f.original_currency == "USD"
    assert f.price == 12800  # 400 * 32.0


@pytest.mark.asyncio
async def test_kiwi_single_parse_failure_does_not_crash():
    """壞掉的 itinerary 跳過，其餘照常回傳（G13）。"""
    from unittest.mock import AsyncMock
    from providers.kiwi_provider import KiwiProvider

    payload = _make_kiwi_payload()
    payload["itineraries"].insert(0, {"price": 1, "outbound": None})  # unparsable

    provider = KiwiProvider()
    with patch.object(provider, "_call_mcp", new=AsyncMock(return_value=payload)):
        result = await provider.search("TPE", "NRT", "2026-08-05")

    assert len(result.flights) == 1
    assert result.flights[0].flight_no == "MM620"


@pytest.mark.asyncio
async def test_kiwi_malformed_time_string_skips_itinerary():
    """L4：時間字串非 ISO 格式時，該筆 itinerary 跳過（不讓錯誤時間流出去），其餘照常回傳。"""
    from unittest.mock import AsyncMock
    from providers.kiwi_provider import KiwiProvider

    payload = _make_kiwi_payload()
    bad = _make_kiwi_payload(price=3000)["itineraries"][0]
    bad["outbound"]["departureTime"] = "not-a-timestamp"  # 舊版切片會靜默得到 "estam"
    payload["itineraries"].insert(0, bad)

    provider = KiwiProvider()
    with patch.object(provider, "_call_mcp", new=AsyncMock(return_value=payload)):
        result = await provider.search("TPE", "NRT", "2026-08-05")

    # 畸形時間那筆被跳過，只剩正常那筆，且時間格式正確
    assert len(result.flights) == 1
    assert result.flights[0].depart_time == "02:00"
    assert result.flights[0].arrive_time == "06:30"


@pytest.mark.asyncio
async def test_kiwi_unknown_currency_returns_empty_result():
    """L5：非 TWD/USD 幣別（無兜底匯率）時整批防禦性丟棄，回傳空結果而非錯誤。"""
    from unittest.mock import AsyncMock
    from providers.kiwi_provider import KiwiProvider

    provider = KiwiProvider()
    payload = _make_kiwi_payload(price=250, currency="EUR")

    with patch.object(provider, "_call_mcp", new=AsyncMock(return_value=payload)):
        result = await provider.search("TPE", "NRT", "2026-08-05")

    # 空 flights 清單是成功結果（G2）：search_chain 不會視為 provider 失敗
    assert result.source == "kiwi"
    assert result.flights == []
