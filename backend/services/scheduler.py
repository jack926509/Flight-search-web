"""Daily price-history scheduler — idempotent, misfire-safe (APScheduler)."""
import asyncio
import logging
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from db import repository as repo

logger = logging.getLogger(__name__)

_TZ = ZoneInfo("Asia/Taipei")


async def _fetch_route(route: str, cached_search, db) -> None:
    from datetime import datetime

    origin, dest = route.split("-")
    # Job fires at 09:00 Asia/Taipei — use the Taipei date, not the container's local date
    today = datetime.now(_TZ).date().isoformat()

    # 整段包 try：gather(return_exceptions=True) 會靜默吞例外，這裡必須自行留 log
    try:
        if await repo.has_history_today(db, route, today):
            logger.info("scheduler: route=%s date=%s already fetched, skipping", route, today)
            return

        result = await cached_search.search(origin, dest, today, 1, "economy")
        logger.info(
            "scheduler: route=%s date=%s fetched %d flights source=%s",
            route, today, len(result.flights), result.source,
        )
    except Exception as exc:
        logger.error("scheduler: route=%s date=%s failed: %s", route, today, exc)


async def _daily_job(cached_search, db) -> None:
    logger.info("scheduler: daily_job starting")
    try:
        routes = await repo.get_tracked_routes(db)
    except Exception as exc:
        logger.error("scheduler: failed to get tracked routes: %s", exc)
        return

    await asyncio.gather(
        *[_fetch_route(r, cached_search, db) for r in routes],
        return_exceptions=True,
    )
    logger.info("scheduler: daily_job done (%d routes)", len(routes))


async def _tracker_job(cached_search, db) -> None:
    logger.info("scheduler: tracker_job starting")
    try:
        from services.tracker_service import check_all_trackers
        checked = await check_all_trackers(db, cached_search)
    except Exception as exc:
        logger.error("scheduler: tracker_job failed: %s", exc)
        return
    logger.info("scheduler: tracker_job done (%d trackers checked)", checked)


def create_scheduler(cached_search, db) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _daily_job,
        trigger=CronTrigger(hour=9, minute=0, timezone="Asia/Taipei"),
        args=[cached_search, db],
        id="daily_price_fetch",
        replace_existing=True,
        misfire_grace_time=3600,  # run within 1h if missed (e.g. late startup)
    )
    scheduler.add_job(
        _tracker_job,
        trigger=CronTrigger(hour=10, minute=0, timezone="Asia/Taipei"),
        args=[cached_search, db],
        id="daily_tracker_check",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    return scheduler
