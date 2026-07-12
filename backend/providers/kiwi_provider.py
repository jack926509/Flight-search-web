import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

from db import repository as repo
from .base import Flight, FlightProvider, SearchResult

logger = logging.getLogger(__name__)

# Kiwi.com 官方公開 MCP 端點（streamable HTTP、免金鑰）
_KIWI_MCP_URL = os.getenv("KIWI_MCP_URL", "https://mcp.kiwi.com/")
_KIWI_TOOL_NAME = "search-flight"
_CALL_TIMEOUT_S = 30

# M=economy, W=premium economy, C=business, F=first
_CABIN_MAP = {
    "economy": "M",
    "premium-economy": "W",
    "business": "C",
    "first": "F",
}

# G3/G4 流量自律：免費服務也設月上限，達 90% 即停用本 provider
_KIWI_MONTHLY_QUOTA = int(os.getenv("KIWI_MONTHLY_QUOTA", "3000"))
_KIWI_SOFT_LIMIT = int(_KIWI_MONTHLY_QUOTA * 0.9)
_FX_USD_TWD = float(os.getenv("FX_USD_TWD", "32.0"))  # 幣別兜底匯率（附錄 B）


class QuotaExceeded(Exception):
    """Raised when the provider's monthly quota soft limit (90%) is reached."""


def _booking_url(origin: str, dest: str, date: str) -> str:
    return f"https://www.google.com/travel/flights/search?q=flights+from+{origin}+to+{dest}+on+{date}"


def _to_kiwi_date(iso_date: str) -> str:
    """YYYY-MM-DD → DD/MM/YYYY（Kiwi MCP 的日期格式）"""
    y, m, d = iso_date.split("-")
    return f"{d}/{m}/{y}"


def _format_time(iso_str: str) -> str:
    """解析 ISO 8601 時間字串為 HH:MM。

    L4：原本用固定切片 `[11:16]`，若 Kiwi 回傳的格式跟預期不同，切片不會拋例外，
    只會靜默得到錯誤或空白時間。改用 `datetime.fromisoformat` 讓格式異常時明確
    拋出 ValueError，交給呼叫端既有的逐筆 try/except 記 log 並跳過該筆 itinerary。
    """
    return datetime.fromisoformat(iso_str).strftime("%H:%M")


class KiwiProvider(FlightProvider):
    name = "kiwi"

    def __init__(self) -> None:
        self._url = _KIWI_MCP_URL
        self._db = None

    def set_db(self, db) -> None:
        self._db = db

    @staticmethod
    def _month_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m")

    async def _check_and_increment_quota(self) -> None:
        """G3: check quota BEFORE API call; increment BEFORE call so failed calls count."""
        if self._db is None:
            return
        month_key = self._month_key()
        try:
            # DB 掛住不能卡死備援路徑：配額計數以 8s 硬性逾時兜底
            async with asyncio.timeout(8):
                current = await repo.get_monthly_calls(self._db, self.name, month_key)
                if current >= _KIWI_SOFT_LIMIT:
                    raise QuotaExceeded(
                        f"kiwi quota soft limit reached ({current}/{_KIWI_SOFT_LIMIT})"
                    )
                await repo.increment_monthly_calls(self._db, self.name, month_key)
        except QuotaExceeded:
            raise
        except Exception as exc:
            logger.warning("kiwi: quota check failed (non-fatal): %s", exc)

    async def _call_mcp(self, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call the Kiwi MCP search-flight tool and return the parsed JSON payload."""
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        async with asyncio.timeout(_CALL_TIMEOUT_S):
            async with streamablehttp_client(self._url) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(_KIWI_TOOL_NAME, arguments=arguments)

        if result.isError:
            texts = [c.text for c in result.content if getattr(c, "text", None)]
            raise RuntimeError(f"kiwi MCP tool error: {' '.join(texts)[:300]}")

        if result.structuredContent:
            return result.structuredContent
        for content in result.content:
            text = getattr(content, "text", None)
            if text:
                return json.loads(text)
        raise RuntimeError("kiwi MCP returned no parsable content")

    def _parse(
        self, payload: dict[str, Any], origin: str, dest: str, date: str
    ) -> list[Flight]:
        response_currency = payload.get("currency", "TWD")
        original_currency: str | None = None
        fx = 1.0
        if response_currency != "TWD":
            if response_currency == "USD":
                fx = _FX_USD_TWD
                original_currency = "USD"
            else:
                # L5：非 TWD/USD 幣別無兜底匯率可換算，防禦性丟棄整批結果。search_chain
                # 對「回傳空 flights 清單」視為該 provider 的正常成功結果（非錯誤，見
                # search_chain.py 的 G2 註解），不會被誤判成 provider 失敗；這裡把丟棄
                # 事件記進 log，方便日後發現需要擴充兜底匯率表。
                logger.warning(
                    "kiwi: response in %s with no FX rate — dropping results (origin=%s dest=%s date=%s)",
                    response_currency, origin, dest, date,
                )
                return []

        flights: list[Flight] = []
        for itin in payload.get("itineraries", []):
            try:
                outbound = itin["outbound"]
                segments = outbound["segments"]
                first_seg = segments[0]
                flights.append(Flight(
                    airline=first_seg.get("carrier", ""),
                    flight_no=first_seg.get("flightNumber", ""),
                    depart_time=_format_time(outbound["departureTime"]),
                    arrive_time=_format_time(outbound["arrivalTime"]),
                    duration_min=int(outbound["durationSeconds"]) // 60,
                    stops=int(outbound.get("stops", max(len(segments) - 1, 0))),
                    price=round(float(itin["price"]) * fx),
                    currency="TWD",
                    original_currency=original_currency,
                    booking_hint=_booking_url(origin, dest, date),
                ))
            except Exception as exc:
                logger.warning("kiwi: failed to parse one itinerary: %s", exc)
        return flights

    async def search(
        self,
        origin: str,
        dest: str,
        date: str,
        adults: int = 1,
        cabin: str = "economy",
    ) -> SearchResult:
        # G3: check+increment quota BEFORE the API call
        await self._check_and_increment_quota()

        arguments = {
            "flyFrom": origin,
            "flyTo": dest,
            "departureDate": _to_kiwi_date(date),
            "adults": adults,
            "cabinClass": _CABIN_MAP.get(cabin, "M"),
            "currency": "TWD",
        }

        payload: dict[str, Any] | None = None
        async for attempt in AsyncRetrying(
            wait=wait_exponential(multiplier=1, min=1, max=2),
            stop=stop_after_attempt(3),
            reraise=True,
        ):
            with attempt:
                payload = await self._call_mcp(arguments)

        return SearchResult(
            flights=self._parse(payload or {}, origin, dest, date),
            source=self.name,
            fetched_at=datetime.now(timezone.utc),
        )
