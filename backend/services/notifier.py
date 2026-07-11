"""LINE push notifications for anonymous price-tracker events.

Single-recipient design: pushes to one LINE user (the site owner) whenever a
tracker event (target price hit / price drop) has not yet been notified.
Silently disabled (not an error) when LINE_CHANNEL_ACCESS_TOKEN /
LINE_TARGET_USER_ID are not configured, so this module is a safe no-op on
environments that don't set up LINE.
"""
import logging
import os

import httpx

from services.tracker_service import tracker_display_name

logger = logging.getLogger(__name__)

_LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"

# 單次批次上限，保護 LINE 免費方案的每月推播配額
_MAX_EVENTS_PER_RUN = 10

_EVENT_LABELS = {
    "target_price": ("🎯", "已達目標價"),
    "price_drop": ("📉", "降價通知"),
}

_warned_missing_config = False


def _warn_missing_config_once() -> None:
    global _warned_missing_config
    if not _warned_missing_config:
        logger.info("notifier: LINE_CHANNEL_ACCESS_TOKEN / LINE_TARGET_USER_ID 未設定，LINE 推播已靜默關閉")
        _warned_missing_config = True


def _format_event_message(event: dict) -> str | None:
    tracker = event.get("price_trackers")
    if not tracker:
        logger.warning("notifier: event %s missing joined tracker info, skip", event.get("id"))
        return None

    emoji, title = _EVENT_LABELS.get(event.get("event_type"), ("🔔", "價格通知"))
    route_date = tracker_display_name(tracker)

    lines = [f"{emoji} {title}", route_date]

    price = event.get("price_twd")
    if price is not None:
        lines.append(f"目前價格：NT$ {price:,}")

    if event.get("event_type") == "target_price" and event.get("target_price_twd"):
        lines.append(f"目標價：NT$ {event['target_price_twd']:,}")
    elif event.get("previous_price_twd"):
        lines.append(f"前次價格：NT$ {event['previous_price_twd']:,}")

    return "\n".join(lines)


async def send_line(text: str) -> bool:
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
    to = os.getenv("LINE_TARGET_USER_ID", "")
    if not token or not to:
        _warn_missing_config_once()
        return False

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                _LINE_PUSH_URL,
                headers={"Authorization": f"Bearer {token}"},
                json={"to": to, "messages": [{"type": "text", "text": text}]},
            )
        if resp.status_code // 100 != 2:
            logger.warning(
                "notifier: LINE push failed status=%s body=%s",
                resp.status_code, resp.text[:200],
            )
            return False
        return True
    except Exception as exc:
        logger.warning("notifier: LINE push error: %s", exc)
        return False


async def notify_pending_events() -> int:
    from db import client as db_client
    from db import tracker_repository as tracker_repo

    try:
        db = await db_client.get_client()
    except Exception as exc:
        logger.warning("notifier: db unavailable, skip: %s", exc)
        return 0

    try:
        events = await tracker_repo.list_unnotified_events(db)
    except Exception as exc:
        logger.warning("notifier: failed to list unnotified events: %s", exc)
        return 0

    sent = 0
    for event in events[:_MAX_EVENTS_PER_RUN]:
        text = _format_event_message(event)
        if not text:
            continue
        if not await send_line(text):
            continue
        try:
            await tracker_repo.mark_event_notified(db, event["id"])
        except Exception as exc:
            logger.warning("notifier: failed to mark event %s notified: %s", event.get("id"), exc)
            continue
        sent += 1

    return sent
