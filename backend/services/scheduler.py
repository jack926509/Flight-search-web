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
    from datetime import date as Date

    origin, dest = route.split("-")
    today = Date.today().isoformat()  # uses local date; container should be UTC-agnostic here

    if await repo.has_history_today(db, route, today):
        logger.info("scheduler: route=%s date=%s already fetched, skipping", route, today)
        return

    try:
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
    return scheduler
