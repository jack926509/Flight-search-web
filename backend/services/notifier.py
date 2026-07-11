"""Telegram push notifications for anonymous price-tracker events.

Single-recipient design: pushes to one chat_id (the site owner) whenever a
tracker event (target price hit / price drop) has not yet been notified.
Silently disabled (not an error) when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
are not configured, so this module is a safe no-op on environments that
don't set up Telegram.
"""
import html
import logging
import os

import httpx

from services.tracker_service import tracker_display_name

logger = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"

_EVENT_LABELS = {
    "target_price": ("🎯", "已達目標價"),
    "price_drop": ("📉", "降價通知"),
}

_warned_missing_config = False


def _warn_missing_config_once() -> None:
    global _warned_missing_config
    if not _warned_missing_config:
        logger.info("notifier: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 未設定，Telegram 推播已靜默關閉")
        _warned_missing_config = True


def _format_event_message(event: dict) -> str | None:
    tracker = event.get("price_trackers")
    if not tracker:
        logger.warning("notifier: event %s missing joined tracker info, skip", event.get("id"))
        return None

    emoji, title = _EVENT_LABELS.get(event.get("event_type"), ("🔔", "價格通知"))
    route_date = html.escape(tracker_display_name(tracker))

    lines = [f"{emoji} <b>{html.escape(title)}</b>", route_date]

    price = event.get("price_twd")
    if price is not None:
        lines.append(f"目前價格：NT$ {price:,}")

    if event.get("event_type") == "target_price" and event.get("target_price_twd"):
        lines.append(f"目標價：NT$ {event['target_price_twd']:,}")
    elif event.get("previous_price_twd"):
        lines.append(f"前次價格：NT$ {event['previous_price_twd']:,}")

    return "\n".join(lines)


async def send_telegram(text: str) -> bool:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        _warn_missing_config_once()
        return False

    url = _TELEGRAM_API.format(token=token)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
        if resp.status_code != 200:
            logger.warning(
                "notifier: telegram sendMessage failed status=%s body=%s",
                resp.status_code, resp.text[:200],
            )
            return False
        return True
    except Exception as exc:
        logger.warning("notifier: telegram sendMessage error: %s", exc)
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
    for event in events:
        text = _format_event_message(event)
        if not text:
            continue
        if not await send_telegram(text):
            continue
        try:
            await tracker_repo.mark_event_notified(db, event["id"])
        except Exception as exc:
            logger.warning("notifier: failed to mark event %s notified: %s", event.get("id"), exc)
            continue
        sent += 1

    return sent
