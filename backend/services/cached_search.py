import asyncio
import logging
import os
from datetime import datetime

from supabase import AsyncClient

from db import repository as repo
from providers.base import Flight, SearchResult
from services.search_chain import AllProvidersFailed, SearchChain

logger = logging.getLogger(__name__)

# 快取層任何 DB 操作的硬性逾時：DB 掛掉時搜尋必須退化為直查，不能被拖垮
_DB_OP_TIMEOUT_S = 8


class CachedSearch:
    def __init__(self, chain: SearchChain, db: AsyncClient) -> None:
        self._chain = chain
        self._db = db

    def _ttl(self) -> int:
        """Use longer TTL when throttled (§5.5) — auto-detected or forced via THROTTLE_MODE=on."""
        if os.getenv("THROTTLE_MODE", "off").strip().lower() == "on":
            return int(os.getenv("CACHE_TTL_THROTTLED_MINUTES", "180"))
        providers = getattr(self._chain, "_providers", [])
        if any(getattr(p, "_throttled", False) for p in providers):
            return int(os.getenv("CACHE_TTL_THROTTLED_MINUTES", "180"))
        return int(os.getenv("CACHE_TTL_MINUTES", "45"))

    @staticmethod
    def _make_cache_key(origin: str, dest: str, date: str, adults: int, cabin: str) -> str:
        return f"{origin}:{dest}:{date}:{adults}:{cabin}"

    async def search(
        self,
        origin: str,
        dest: str,
        date: str,
        adults: int = 1,
        cabin: str = "economy",
    ) -> SearchResult:
        cache_key = self._make_cache_key(origin, dest, date, adults, cabin)

        # ── 1. Unexpired cache hit ────────────────────────────────────────────
        # DB 故障（例外或掛住）視為 cache miss：快取層絕不能拖垮即時查詢
        row = None
        try:
            async with asyncio.timeout(_DB_OP_TIMEOUT_S):
                row = await repo.get_cached(self._db, cache_key)
        except Exception as exc:
            logger.warning("cache read failed — treating as miss (non-fatal): %s", exc)
        if row:
            payload = row["payload"]
            return SearchResult(
                flights=[Flight(**f) for f in payload["flights"]],
                source="cache",
                fetched_at=datetime.fromisoformat(payload["fetched_at"]),
                stale=False,
            )

        # ── 2. Live query ─────────────────────────────────────────────────────
        try:
            result = await self._chain.search(origin, dest, date, adults, cabin)

            # 寫入類 DB 操作全部 non-fatal：provider 已拿到結果，DB 掛不能害查詢 500
            try:
                async with asyncio.timeout(_DB_OP_TIMEOUT_S):
                    await repo.set_cache(
                        self._db, cache_key, result.model_dump(mode="json"), result.source, self._ttl()
                    )

                    # G1: only baseline queries write price history
                    if adults == 1 and cabin == "economy" and result.flights:
                        min_price = min(f.price for f in result.flights)
                        await repo.upsert_price_history(
                            self._db,
                            route=f"{origin}-{dest}",
                            date=date,
                            price=min_price,
                            source=result.source,
                        )

                    await repo.delete_old_cache(self._db)
            except Exception as exc:
                logger.warning("cache/history write failed (non-fatal): %s", exc)
            return result

        except AllProvidersFailed:
            # ── 3. Stale fallback ─────────────────────────────────────────────
            # stale 讀取失敗照樣 raise AllProvidersFailed（503），不可變成 500
            stale_row = None
            try:
                async with asyncio.timeout(_DB_OP_TIMEOUT_S):
                    stale_row = await repo.get_stale_cached(self._db, cache_key)
            except Exception as exc:
                logger.warning("stale cache read failed (non-fatal): %s", exc)
            if stale_row:
                payload = stale_row["payload"]
                logger.warning(
                    "all providers failed, returning stale cache for %s (fetched_at=%s)",
                    cache_key,
                    payload.get("fetched_at"),
                )
                return SearchResult(
                    flights=[Flight(**f) for f in payload["flights"]],
                    source=payload.get("source", "cache"),
                    fetched_at=datetime.fromisoformat(payload["fetched_at"]),
                    stale=True,
                )
            raise
