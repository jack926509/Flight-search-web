"""Server-side, resumable worker for station range scans."""
import asyncio
import logging
from datetime import date as DateType

from db import scan_repository as repo

logger = logging.getLogger(__name__)
_DISPATCH_INTERVAL_SECONDS = 1.7
_running_jobs: set[str] = set()


def build_tasks(stations: list[str], dates: list[str]) -> list[tuple[str, str]]:
    return [(station, day) for station in ["TPE", *stations] for day in dates]


def dates_inclusive(start: str, end: str) -> list[str]:
    first = DateType.fromisoformat(start)
    last = DateType.fromisoformat(end)
    return [(first.fromordinal(day)).isoformat() for day in range(first.toordinal(), last.toordinal() + 1)]


async def run_station_scan(db, cached_search, job_id: str) -> None:
    if job_id in _running_jobs:
        return
    _running_jobs.add(job_id)
    try:
        job = await repo.get_job(db, job_id)
        if not job or job.get("status") == "cancelled":
            return
        await repo.reset_running_cells(db, job_id)
        await repo.update_job(db, job_id, "running")
        while not await repo.is_cancelled(db, job_id):
            cell = await repo.next_pending_cell(db, job_id)
            if not cell:
                await repo.update_job(db, job_id, "completed")
                return
            await repo.mark_cell(db, cell["id"], "running")
            try:
                result = await cached_search.search(
                    cell["station"], job["dest"], str(cell["departure_date"]), job["adults"], job["cabin"]
                )
                flights = [flight.model_dump(mode="json") for flight in result.flights]
                await repo.mark_cell(db, cell["id"], "done" if flights else "empty", flights=flights)
            except Exception as exc:
                logger.warning("station scan %s cell %s failed: %s", job_id, cell["id"], exc)
                await repo.mark_cell(db, cell["id"], "error", flights=[], error=str(exc))
            await asyncio.sleep(_DISPATCH_INTERVAL_SECONDS)
    except Exception as exc:
        logger.exception("station scan %s worker failed: %s", job_id, exc)
        try:
            await repo.update_job(db, job_id, "failed")
        except Exception:
            pass
    finally:
        _running_jobs.discard(job_id)


def start_station_scan(db, cached_search, job_id: str) -> None:
    asyncio.create_task(run_station_scan(db, cached_search, job_id), name=f"station-scan-{job_id}")


async def resume_station_scans(db, cached_search) -> None:
    """Continue pending work after a Zeabur restart instead of leaving jobs permanently running."""
    for job in await repo.list_resumable_jobs(db):
        start_station_scan(db, cached_search, job["id"])
