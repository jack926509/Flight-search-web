"""All Supabase DB operations for Phase 2+3."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from supabase import AsyncClient

logger = logging.getLogger(__name__)

_UTC = timezone.utc


def _now_utc() -> str:
    return datetime.now(_UTC).isoformat()


def _expires_at(ttl_minutes: int) -> str:
    return (datetime.now(_UTC) + timedelta(minutes=ttl_minutes)).isoformat()


def _cutoff_7d() -> str:
    return (datetime.now(_UTC) - timedelta(days=7)).isoformat()


# ── cache ─────────────────────────────────────────────────────────────────────

async def get_cached(db: AsyncClient, cache_key: str) -> dict | None:
    """Return unexpired cache row or None."""
    resp = (
        await db.table("search_cache")
        .select("payload,source,created_at,expires_at")
        .eq("cache_key", cache_key)
        .gt("expires_at", _now_utc())
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


async def get_stale_cached(db: AsyncClient, cache_key: str) -> dict | None:
    """Return most recent cache row regardless of expiry (stale fallback)."""
    resp = (
        await db.table("search_cache")
        .select("payload,source,created_at,expires_at")
        .eq("cache_key", cache_key)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


async def set_cache(
    db: AsyncClient,
    cache_key: str,
    payload: dict,
    source: str,
    ttl_minutes: int,
) -> None:
    await db.table("search_cache").upsert(
        {
            "cache_key": cache_key,
            "payload": payload,
            "source": source,
            "expires_at": _expires_at(ttl_minutes),
        },
        on_conflict="cache_key",
    ).execute()


async def delete_old_cache(db: AsyncClient) -> None:
    """Delete cache rows expired more than 7 days ago."""
    try:
        await db.table("search_cache").delete().lt("expires_at", _cutoff_7d()).execute()
    except Exception as exc:
        logger.warning("cleanup old cache failed (non-fatal): %s", exc)


# ── price history ─────────────────────────────────────────────────────────────

async def upsert_price_history(
    db: AsyncClient,
    route: str,
    date: str,
    price: int,
    source: str,
) -> None:
    """Write lowest daily price; update only if new price is lower (G1 baseline rule applied by caller)."""
    resp = (
        await db.table("price_history")
        .select("id,lowest_price_twd")
        .eq("route", route)
        .eq("date", date)
        .limit(1)
        .execute()
    )
    if resp.data:
        if price < resp.data[0]["lowest_price_twd"]:
            await db.table("price_history").update(
                {"lowest_price_twd": price, "source": source}
            ).eq("id", resp.data[0]["id"]).execute()
    else:
        await db.table("price_history").insert(
            {"route": route, "date": date, "lowest_price_twd": price, "source": source}
        ).execute()


async def get_price_history(
    db: AsyncClient, route: str, days: int
) -> list[dict]:
    since = (datetime.now(_UTC) - timedelta(days=days)).date().isoformat()
    resp = (
        await db.table("price_history")
        .select("date,lowest_price_twd,source,recorded_at")
        .eq("route", route)
        .gte("date", since)
        .order("date")
        .execute()
    )
    return resp.data


# ── Phase 3: scheduler + quota ────────────────────────────────────────────────

async def get_tracked_routes(db: AsyncClient) -> list[str]:
    resp = await db.table("tracked_routes").select("route").eq("enabled", True).execute()
    return [r["route"] for r in resp.data]


async def has_history_today(db: AsyncClient, route: str, date: str) -> bool:
    resp = (
        await db.table("price_history")
        .select("id")
        .eq("route", route)
        .eq("date", date)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


async def get_monthly_calls(db: AsyncClient, provider: str, month_key: str) -> int:
    resp = (
        await db.table("provider_status")
        .select("monthly_calls,month_key")
        .eq("provider", provider)
        .limit(1)
        .execute()
    )
    if not resp.data or resp.data[0].get("month_key") != month_key:
        return 0
    return resp.data[0].get("monthly_calls", 0)


async def increment_monthly_calls(db: AsyncClient, provider: str, month_key: str) -> int:
    """Increment monthly_calls and return new count; resets if month changed."""
    resp = (
        await db.table("provider_status")
        .select("monthly_calls,month_key")
        .eq("provider", provider)
        .limit(1)
        .execute()
    )
    if resp.data and resp.data[0].get("month_key") == month_key:
        new_count = resp.data[0].get("monthly_calls", 0) + 1
    else:
        new_count = 1
    await db.table("provider_status").upsert(
        {"provider": provider, "monthly_calls": new_count, "month_key": month_key},
        on_conflict="provider",
    ).execute()
    return new_count


async def set_throttled(db: AsyncClient, provider: str, throttled: bool) -> None:
    try:
        await db.table("provider_status").upsert(
            {"provider": provider, "throttled": throttled},
            on_conflict="provider",
        ).execute()
    except Exception as exc:
        logger.warning("set_throttled failed (non-fatal): %s", exc)


# ── health / Postgres liveness ────────────────────────────────────────────────

async def ping_db(db: AsyncClient) -> bool:
    """True if Postgres is reachable — used by health endpoint to keep Supabase Free alive (G12).

    DB 連線黑洞（DNS 停滯／TCP 不回）時 await 會無限掛住，health 端點跟著掛，
    監控會誤判整個服務死亡而非 db:false——必須硬性逾時。
    """
    try:
        async with asyncio.timeout(5):
            await db.table("tracked_routes").select("route").limit(1).execute()
        return True
    except Exception:
        return False
