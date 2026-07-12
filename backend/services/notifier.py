"""LINE push notifications for anonymous price-tracker events.

Single-recipient design: pushes to one LINE user (the site owner) whenever a
tracker event (target price hit / price drop) has not yet been notified.
Silently disabled (not an error) when LINE_CHANNEL_ACCESS_TOKEN /
LINE_TARGET_USER_ID are not configured, so this module is a safe no-op on
environments that don't set up LINE.

Messages are LINE Flex cards styled after the site's 暖砂 palette; if an
event lacks the fields needed for a card we fall back to a plain-text push
so no event is ever silently dropped for formatting reasons.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

_LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"

_SITE_URL = os.getenv("SITE_URL", "https://flight-search-web-29x.pages.dev/").rstrip("/") + "/"

# 單次批次上限，保護 LINE 免費方案的每月推播配額
_MAX_EVENTS_PER_RUN = 10

# 與前端 tailwind.config.ts 的暖砂 token 同步
_COLOR_PRIMARY = "#B0522E"
_COLOR_INK = "#2B2420"
_COLOR_MUTED = "#6B5E54"
_COLOR_PRICE = "#9A4620"
_COLOR_GREEN = "#55702F"
_COLOR_LINE = "#EBE4DD"
_COLOR_CARD = "#FFFFFF"

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


def _tracker_deep_link(tracker: dict) -> str:
    """組出點開即自動搜尋該路線的網站連結（前端已支援 URL 參數自動查詢）。"""
    from urllib.parse import urlencode

    params: dict[str, str] = {
        "origin": tracker.get("origin", ""),
        "dest": tracker.get("dest", ""),
        "date": str(tracker.get("depart_date", "")),
    }
    if tracker.get("trip_type") == "round-trip" and tracker.get("return_date"):
        params["trip"] = "round-trip"
        params["returnDate"] = str(tracker["return_date"])
    return f"{_SITE_URL}?{urlencode(params)}"


def _route_heading(tracker: dict) -> tuple[str, str]:
    """回傳 (路線主標, 日期副標)，來回與單程各自的寫法。"""
    if tracker.get("trip_type") == "round-trip":
        return (
            f"{tracker['origin']} ⇄ {tracker['dest']}",
            f"去 {tracker['depart_date']}・回 {tracker['return_date']}・來回",
        )
    return f"{tracker['origin']} → {tracker['dest']}", f"出發 {tracker['depart_date']}・單程"


def _price_row(label: str, value: str, *, strike: bool = False) -> dict:
    value_text: dict = {
        "type": "text",
        "text": value,
        "size": "sm",
        "color": _COLOR_MUTED,
        "align": "end",
    }
    if strike:
        value_text["decoration"] = "line-through"
    return {
        "type": "box",
        "layout": "baseline",
        "contents": [
            {"type": "text", "text": label, "size": "sm", "color": _COLOR_MUTED, "flex": 0},
            value_text,
        ],
    }


def _build_message(event: dict) -> dict | None:
    """組出單一事件的 LINE 訊息物件（Flex 卡片；缺價格時退回純文字）。"""
    tracker = event.get("price_trackers")
    if not tracker:
        logger.warning("notifier: event %s missing joined tracker info, skip", event.get("id"))
        return None

    emoji, title = _EVENT_LABELS.get(event.get("event_type"), ("🔔", "價格通知"))
    route, date_line = _route_heading(tracker)

    price = event.get("price_twd")
    if price is None:
        # 沒有價格就組不出卡片重點，退回純文字通知
        return {"type": "text", "text": f"{emoji} {title}\n{route}\n{date_line}"}

    body_rows: list[dict] = [
        {"type": "text", "text": route, "size": "xl", "weight": "bold", "color": _COLOR_INK},
        {"type": "text", "text": date_line, "size": "sm", "color": _COLOR_MUTED},
        {"type": "separator", "margin": "lg", "color": _COLOR_LINE},
        {
            "type": "box",
            "layout": "baseline",
            "margin": "lg",
            "contents": [
                {"type": "text", "text": "目前最低價", "size": "sm", "color": _COLOR_MUTED, "flex": 0},
                {
                    "type": "text",
                    "text": f"NT$ {price:,}",
                    "size": "xxl",
                    "weight": "bold",
                    "color": _COLOR_PRICE,
                    "align": "end",
                },
            ],
        },
    ]

    target = event.get("target_price_twd")
    previous = event.get("previous_price_twd")

    if event.get("event_type") == "target_price" and target:
        body_rows.append(_price_row("目標價", f"NT$ {target:,}"))
        if previous and previous > price:
            body_rows.append(_price_row("前次價格", f"NT$ {previous:,}", strike=True))
        body_rows.append(
            {
                "type": "text",
                "text": f"✓ 已低於你設定的目標價 NT$ {target:,}",
                "size": "sm",
                "weight": "bold",
                "color": _COLOR_GREEN,
                "margin": "md",
                "wrap": True,
            }
        )
    elif previous:
        body_rows.append(_price_row("前次價格", f"NT$ {previous:,}", strike=True))
        saved = previous - price
        if saved > 0:
            pct = saved / previous * 100
            body_rows.append(
                {
                    "type": "text",
                    "text": f"↓ 比上次便宜 NT$ {saved:,}（{pct:.1f}%）",
                    "size": "sm",
                    "weight": "bold",
                    "color": _COLOR_GREEN,
                    "margin": "md",
                }
            )

    bubble = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": _COLOR_PRIMARY,
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": f"{emoji} {title}", "color": "#FFFFFF", "weight": "bold", "size": "md"}
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "paddingAll": "20px",
            "backgroundColor": _COLOR_CARD,
            "contents": body_rows,
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "paddingAll": "12px",
            "contents": [
                {
                    "type": "button",
                    "style": "primary",
                    "color": _COLOR_PRIMARY,
                    "height": "sm",
                    "action": {
                        "type": "uri",
                        "label": "查看即時票價",
                        "uri": _tracker_deep_link(tracker),
                    },
                }
            ],
        },
    }

    return {
        "type": "flex",
        "altText": f"{emoji} {title}｜{route} 目前 NT$ {price:,}",
        "contents": bubble,
    }


async def send_line(message: dict) -> bool:
    """推送單一 LINE 訊息物件（text 或 flex），成功回 True。"""
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
                json={"to": to, "messages": [message]},
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
        message = _build_message(event)
        if not message:
            continue
        if not await send_line(message):
            continue
        try:
            await tracker_repo.mark_event_notified(db, event["id"])
        except Exception as exc:
            logger.warning("notifier: failed to mark event %s notified: %s", event.get("id"), exc)
            continue
        sent += 1

    return sent
