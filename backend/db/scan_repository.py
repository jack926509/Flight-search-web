"""Supabase persistence for resumable station-scan jobs."""
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_job(db, payload: dict, cells: list[dict]) -> dict:
    job = await db.table("station_scan_jobs").insert(payload).execute()
    await db.table("station_scan_cells").insert(cells).execute()
    return job.data[0]


async def get_job(db, job_id: str) -> dict | None:
    result = await db.table("station_scan_jobs").select("*").eq("id", job_id).limit(1).execute()
    return result.data[0] if result.data else None


async def get_cells(db, job_id: str) -> list[dict]:
    result = await db.table("station_scan_cells").select("station,departure_date,status,flights,error").eq("job_id", job_id).order("departure_date").execute()
    return result.data


async def next_pending_cell(db, job_id: str) -> dict | None:
    result = (
        await db.table("station_scan_cells").select("id,station,departure_date")
        .eq("job_id", job_id).eq("status", "pending").order("departure_date").limit(1).execute()
    )
    return result.data[0] if result.data else None


async def mark_cell(db, cell_id: str, status: str, flights: list | None = None, error: str | None = None) -> None:
    payload = {"status": status, "updated_at": _now()}
    if flights is not None:
        payload["flights"] = flights
    if error is not None:
        payload["error"] = error[:240]
    await db.table("station_scan_cells").update(payload).eq("id", cell_id).execute()


async def update_job(db, job_id: str, status: str) -> None:
    payload = {"status": status, "updated_at": _now()}
    if status in {"completed", "cancelled", "failed"}:
        payload["finished_at"] = _now()
    await db.table("station_scan_jobs").update(payload).eq("id", job_id).execute()


async def is_cancelled(db, job_id: str) -> bool:
    job = await get_job(db, job_id)
    return not job or job.get("status") == "cancelled"


async def list_resumable_jobs(db) -> list[dict]:
    result = await db.table("station_scan_jobs").select("id").in_("status", ["pending", "running"]).execute()
    return result.data


async def reset_running_cells(db, job_id: str) -> None:
    """A redeploy interrupts in-flight cells; retry them on the replacement process."""
    await db.table("station_scan_cells").update({"status": "pending", "updated_at": _now()}).eq("job_id", job_id).eq("status", "running").execute()
