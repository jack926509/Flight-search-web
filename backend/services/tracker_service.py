"""Anonymous price tracker service."""
import asyncio
import hashlib
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from db import tracker_repository as tracker_repo
from providers.base import SearchResult

_TRACKER_KEY_RE = re.compile(r"^trk_[A-Za-z0-9_-]{32,}$")
_UTC = timezone.utc


class TrackerKeyError(ValueError):
    pass


def generate_tracker_key() -> str:
    return f"trk_{secrets.token_urlsafe(32)}"


def validate_tracker_key(key: str) -> str:
    key = key.strip()
    if not _TRACKER_KEY_RE.fullmatch(key):
        raise TrackerKeyError("追蹤識別碼格式不正確")
    return key


def hash_tracker_key(key: str) -> str:
    return hashlib.sha256(validate_tracker_key(key).encode("utf-8")).hexdigest()


def lowest_price(result: SearchResult) -> int | None:
    if not result.flights:
        return None
    return min(f.price for f in result.flights)


def tracker_display_name(tracker: dict) -> str:
    if tracker["trip_type"] == "round-trip":
        return f"{tracker['origin']} ⇄ {tracker['dest']} {tracker['depart_date']} / {tracker['return_date']}"
    return f"{tracker['origin']} → {tracker['dest']} {tracker['depart_date']}"


def build_tracker_events(tracker: dict, current_price: int) -> list[dict]:
    events: list[dict] = []
    target_price = tracker.get("target_price_twd")
    previous_price = tracker.get("current_price_twd")
    name = tracker_display_name(tracker)

    if target_price and current_price <= target_price:
        events.append(
            {
                "event_type": "target_price",
                "price_twd": current_price,
                "previous_price_twd": previous_price,
                "target_price_twd": target_price,
                "message": f"{name} 已低於目標價：NT$ {current_price:,}",
            }
        )

    if previous_price and current_price < previous_price:
        events.append(
            {
                "event_type": "price_drop",
                "price_twd": current_price,
                "previous_price_twd": previous_price,
                "target_price_twd": target_price,
                "message": f"{name} 比上次便宜：NT$ {previous_price:,} → NT$ {current_price:,}",
            }
        )

    return events


async def resolve_tracker_price(tracker: dict, cached_search) -> int | None:
    adults = int(tracker.get("adults") or 1)
    cabin = tracker.get("cabin") or "economy"
    outbound = await cached_search.search(
        tracker["origin"],
        tracker["dest"],
        str(tracker["depart_date"]),
        adults,
        cabin,
    )
    outbound_price = lowest_price(outbound)
    if outbound_price is None:
        return None

    if tracker["trip_type"] == "one-way":
        return outbound_price

    inbound = await cached_search.search(
        tracker["dest"],
        tracker["origin"],
        str(tracker["return_date"]),
        adults,
        cabin,
    )
    inbound_price = lowest_price(inbound)
    if inbound_price is None:
        return None
    return outbound_price + inbound_price


async def check_tracker(db, cached_search, tracker: dict) -> int | None:
    if not tracker.get("enabled", True):
        return None

    current_price = await resolve_tracker_price(tracker, cached_search)
    if current_price is None:
        return None

    previous_price = tracker.get("current_price_twd")
    for event in build_tracker_events(tracker, current_price):
        await tracker_repo.create_event_once(
            db,
            {
                "tracker_id": tracker["id"],
                "tracker_key_hash": tracker["tracker_key_hash"],
                **event,
            },
        )
    await tracker_repo.set_tracker_price(db, tracker["id"], previous_price, current_price)
    return current_price


async def check_all_trackers(db, cached_search, concurrency: int = 3) -> int:
    trackers = await tracker_repo.list_active_trackers(db)
    sem = asyncio.Semaphore(concurrency)
    checked = 0

    async def run_one(tracker: dict) -> None:
        nonlocal checked
        async with sem:
            if await check_tracker(db, cached_search, tracker) is not None:
                checked += 1

    await asyncio.gather(*(run_one(t) for t in trackers), return_exceptions=True)
    return checked


def create_tracker_payload(data: Any, tracker_key_hash: str, current_price_twd: int | None = None) -> dict:
    return {
        "tracker_key_hash": tracker_key_hash,
        "trip_type": data.trip_type,
        "origin": data.origin,
        "dest": data.dest,
        "depart_date": data.date,
        "return_date": data.return_date,
        "adults": data.adults,
        "cabin": data.cabin,
        "target_price_twd": data.target_price_twd,
        "current_price_twd": current_price_twd,
        "last_checked_at": datetime.now(_UTC).isoformat() if current_price_twd else None,
        "enabled": True,
    }
