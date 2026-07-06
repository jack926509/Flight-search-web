"""All Supabase DB operations for Phase 2."""
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
    from datetime import date as Date
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


# ── health / Postgres liveness ────────────────────────────────────────────────

async def ping_db(db: AsyncClient) -> bool:
    """True if Postgres is reachable — used by health endpoint to keep Supabase Free alive (G12)."""
    try:
        await db.table("tracked_routes").select("route").limit(1).execute()
        return True
    except Exception:
        return False
