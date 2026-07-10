"""Supabase operations for anonymous in-site price trackers."""
from datetime import datetime, timezone

from supabase import AsyncClient

_UTC = timezone.utc


def _now_utc() -> str:
    return datetime.now(_UTC).isoformat()


async def create_tracker(db: AsyncClient, payload: dict) -> dict:
    resp = await db.table("price_trackers").insert(payload).execute()
    return resp.data[0]


async def list_trackers(db: AsyncClient, tracker_key_hash: str) -> list[dict]:
    resp = (
        await db.table("price_trackers")
        .select("*")
        .eq("tracker_key_hash", tracker_key_hash)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data


async def list_events(db: AsyncClient, tracker_key_hash: str, unread_only: bool = False) -> list[dict]:
    query = (
        db.table("tracker_events")
        .select("*")
        .eq("tracker_key_hash", tracker_key_hash)
        .order("created_at", desc=True)
    )
    if unread_only:
        query = query.eq("read", False)
    resp = await query.execute()
    return resp.data


async def get_tracker_for_owner(db: AsyncClient, tracker_id: str, tracker_key_hash: str) -> dict | None:
    resp = (
        await db.table("price_trackers")
        .select("*")
        .eq("id", tracker_id)
        .eq("tracker_key_hash", tracker_key_hash)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


async def update_tracker(db: AsyncClient, tracker_id: str, tracker_key_hash: str, changes: dict) -> dict | None:
    changes["updated_at"] = _now_utc()
    resp = (
        await db.table("price_trackers")
        .update(changes)
        .eq("id", tracker_id)
        .eq("tracker_key_hash", tracker_key_hash)
        .execute()
    )
    return resp.data[0] if resp.data else None


async def delete_tracker(db: AsyncClient, tracker_id: str, tracker_key_hash: str) -> bool:
    resp = (
        await db.table("price_trackers")
        .delete()
        .eq("id", tracker_id)
        .eq("tracker_key_hash", tracker_key_hash)
        .execute()
    )
    return bool(resp.data)


async def list_active_trackers(db: AsyncClient) -> list[dict]:
    resp = (
        await db.table("price_trackers")
        .select("*")
        .eq("enabled", True)
        .order("last_checked_at", desc=False, nullsfirst=True)
        .execute()
    )
    return resp.data


async def set_tracker_price(db: AsyncClient, tracker_id: str, previous_price: int | None, current_price: int) -> None:
    await db.table("price_trackers").update(
        {
            "previous_price_twd": previous_price,
            "current_price_twd": current_price,
            "last_checked_at": _now_utc(),
            "updated_at": _now_utc(),
        }
    ).eq("id", tracker_id).execute()


async def create_event_once(db: AsyncClient, payload: dict) -> None:
    await db.table("tracker_events").upsert(
        payload,
        on_conflict="tracker_id,event_type,price_twd",
    ).execute()


async def mark_events_read(db: AsyncClient, tracker_key_hash: str, tracker_id: str | None = None) -> None:
    query = (
        db.table("tracker_events")
        .update({"read": True})
        .eq("tracker_key_hash", tracker_key_hash)
        .eq("read", False)
    )
    if tracker_id:
        query = query.eq("tracker_id", tracker_id)
    await query.execute()
