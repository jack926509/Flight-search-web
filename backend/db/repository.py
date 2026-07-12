"""All Supabase DB operations for Phase 2+3."""
import asyncio
import logging
import math
import statistics
from datetime import datetime, timedelta, timezone

from supabase import AsyncClient

logger = logging.getLogger(__name__)

_UTC = timezone.utc

_warned_schema_v7_missing = False


def _warn_schema_v7_missing_once(exc: Exception) -> None:
    global _warned_schema_v7_missing
    if not _warned_schema_v7_missing:
        logger.warning(
            "repository: increment_monthly_calls_atomic RPC 不存在（schema_v7 尚未套用到 "
            "Supabase），fallback 回舊版 read-then-write（併發下配額計數有輕微競態，"
            "見穩定性審查 L2，屬低優先軟上限誤差）: %s",
            exc,
        )
        _warned_schema_v7_missing = True


def _is_unique_violation(exc: Exception) -> bool:
    """判斷例外是否為 Postgres unique_violation（23505），不強依賴 postgrest 例外型別。"""
    code = getattr(exc, "code", None)
    if code == "23505":
        return True
    return "23505" in str(exc) or "duplicate key value violates unique constraint" in str(exc)


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
    """Write lowest daily price; update only if new price is lower (G1 baseline rule applied by caller).

    L2：price_history 建表時已有 `unique (route, date)`（schema.sql），schema_v7.sql 再補一個
    具名唯一索引確保約束存在。併發下兩個協程都讀到「無此列」而各自 insert 時，其中一個會撞
    唯一約束——這裡補 conflict 處理：撞到就回頭走 update-if-lower，語意與非併發路徑一致。
    寫法在約束存在與否都能跑（沒有約束就不會撞，insert 分支正常結束）。
    """
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
        return

    try:
        await db.table("price_history").insert(
            {"route": route, "date": date, "lowest_price_twd": price, "source": source}
        ).execute()
    except Exception as exc:
        if not _is_unique_violation(exc):
            raise
        logger.info(
            "price_history: concurrent insert race on route=%s date=%s, falling back to update-if-lower",
            route, date,
        )
        resp2 = (
            await db.table("price_history")
            .select("id,lowest_price_twd")
            .eq("route", route)
            .eq("date", date)
            .limit(1)
            .execute()
        )
        if resp2.data and price < resp2.data[0]["lowest_price_twd"]:
            await db.table("price_history").update(
                {"lowest_price_twd": price, "source": source}
            ).eq("id", resp2.data[0]["id"]).execute()


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


def summarize_price_history(rows: list[dict], current_price: int | None = None) -> dict:
    """Return transparent historical metrics; never gives a judgement under 10 samples."""
    prices = sorted(int(row["lowest_price_twd"]) for row in rows if row.get("lowest_price_twd", 0) > 0)
    sources = sorted({str(row.get("source", "unknown")) for row in rows})
    count = len(prices)
    if count < 10:
        return {"sample_count": count, "sources": sources, "judgement": "collecting"}

    position = (count - 1) * 0.2
    lower = math.floor(position)
    upper = math.ceil(position)
    p20 = round(prices[lower] + (prices[upper] - prices[lower]) * (position - lower))
    judgement = "unknown"
    if current_price is not None:
        judgement = "recent_low" if current_price <= p20 else "normal_or_high"
    return {
        "sample_count": count,
        "lowest": prices[0],
        "average": round(statistics.mean(prices)),
        "median": round(statistics.median(prices)),
        "p20": p20,
        "sources": sources,
        "judgement": judgement,
    }


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
    """Increment monthly_calls and return new count; resets if month changed.

    L2：優先呼叫 `increment_monthly_calls_atomic` RPC（schema_v7.sql，DB 端原子操作，
    無競態）。RPC 不存在時（PostgREST 404 / 函式未建，代表 schema_v7 尚未套用到
    Supabase）fallback 回舊版 read-then-write，並只記一次提示 log。
    """
    try:
        resp = await db.rpc(
            "increment_monthly_calls_atomic",
            {"p_provider": provider, "p_month_key": month_key},
        ).execute()
        return resp.data
    except Exception as exc:
        _warn_schema_v7_missing_once(exc)

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


# ── observability ─────────────────────────────────────────────────────────────

_PROVIDER_HEALTH_FIELDS = (
    "provider,state,failure_count,opened_at,last_success_at,last_failure_at,"
    "last_error,throttled,throttled_until"
)


async def get_provider_health(db: AsyncClient) -> dict[str, dict]:
    """Return public-safe provider status persisted by the backend.

    `last_error` is truncated when written, so this endpoint never needs to
    expose raw exception payloads or upstream response bodies.
    """
    resp = await db.table("provider_status").select(_PROVIDER_HEALTH_FIELDS).execute()
    return {row["provider"]: row for row in resp.data}


async def get_scheduler_health(db: AsyncClient) -> dict[str, dict]:
    resp = (
        await db.table("scheduler_status")
        .select("job_name,last_status,last_started_at,last_finished_at,last_error")
        .execute()
    )
    return {row["job_name"]: row for row in resp.data}


async def mark_scheduler_started(db: AsyncClient, job_name: str) -> None:
    await db.table("scheduler_status").upsert(
        {"job_name": job_name, "last_status": "running", "last_started_at": _now_utc(), "last_error": None},
        on_conflict="job_name",
    ).execute()


async def mark_scheduler_finished(
    db: AsyncClient, job_name: str, status: str, error: str | None = None
) -> None:
    await db.table("scheduler_status").upsert(
        {
            "job_name": job_name,
            "last_status": status,
            "last_finished_at": _now_utc(),
            "last_error": error[:240] if error else None,
        },
        on_conflict="job_name",
    ).execute()
