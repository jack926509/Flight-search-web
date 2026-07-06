"""Circuit breaker E10 test matrix: all 7 required state-machine scenarios."""
import asyncio

import pytest

from services.circuit_breaker import CBState, CircuitBreaker, CircuitBreakerOpen


def _cb(cooldown: int = 300) -> CircuitBreaker:
    return CircuitBreaker("test_provider", cooldown_seconds=cooldown)


# ── 1. CLOSED: 3 consecutive failures → OPEN ─────────────────────────────────

async def test_three_failures_open_circuit():
    cb = _cb()
    assert cb.current_state() == "closed"

    async def failing():
        raise RuntimeError("boom")

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cb.call(failing)
    assert cb.current_state() == "closed"  # not yet

    with pytest.raises(RuntimeError):
        await cb.call(failing)
    assert cb.current_state() == "open"


# ── 2. OPEN: raises CircuitBreakerOpen immediately ───────────────────────────

async def test_open_circuit_raises_immediately():
    cb = _cb()
    cb._state = CBState.OPEN
    from datetime import datetime, timezone
    cb._opened_at = datetime.now(timezone.utc)

    with pytest.raises(CircuitBreakerOpen):
        await cb.call(lambda: None)


# ── 3. OPEN → HALF_OPEN after cooldown ───────────────────────────────────────

async def test_cooldown_transitions_to_half_open():
    cb = _cb(cooldown=0)  # zero-second cooldown
    cb._state = CBState.OPEN
    from datetime import datetime, timezone
    cb._opened_at = datetime.now(timezone.utc)

    # _check_cooldown should flip to HALF_OPEN
    assert cb.current_state() == "half_open"


# ── 4. HALF_OPEN: successful probe → CLOSED ──────────────────────────────────

async def test_half_open_success_closes_circuit():
    cb = _cb()
    cb._state = CBState.HALF_OPEN
    cb._failure_count = 3

    async def success():
        return "ok"

    result = await cb.call(success)
    assert result == "ok"
    assert cb.current_state() == "closed"
    assert cb._failure_count == 0


# ── 5. HALF_OPEN: failed probe → OPEN (reset cooldown) ───────────────────────

async def test_half_open_failure_reopens_circuit():
    cb = _cb(cooldown=999)
    cb._state = CBState.HALF_OPEN
    cb._failure_count = 3

    async def failing():
        raise RuntimeError("still broken")

    with pytest.raises(RuntimeError):
        await cb.call(failing)

    assert cb.current_state() == "open"
    assert cb._opened_at is not None  # cooldown restarted


# ── 6. HALF_OPEN: concurrent second call is rejected (E4) ────────────────────

async def test_half_open_concurrent_probe_blocked():
    cb = _cb()
    cb._state = CBState.HALF_OPEN

    probe_started = asyncio.Event()
    probe_gate = asyncio.Event()

    async def slow_fn():
        probe_started.set()
        await probe_gate.wait()
        return "result"

    task = asyncio.create_task(cb.call(slow_fn))
    await probe_started.wait()  # probe is running and holds the lock

    with pytest.raises(CircuitBreakerOpen, match="probe is busy"):
        await cb.call(lambda: None)

    probe_gate.set()
    result = await task
    assert result == "result"
    assert cb.current_state() == "closed"


# ── 7. CLOSED: success resets failure_count (no-op when already zero) ────────

async def test_closed_success_resets_failure_count():
    cb = _cb()
    cb._failure_count = 2  # some prior failures

    async def success():
        return 42

    result = await cb.call(success)
    assert result == 42
    assert cb._failure_count == 0
    assert cb.current_state() == "closed"


# ── 8. DB persist failure is non-fatal (E6) ──────────────────────────────────

async def test_db_persist_failure_nonfatal():
    from unittest.mock import AsyncMock, MagicMock

    cb = _cb()
    db = MagicMock()
    # Make the DB upsert raise an error
    db.table.return_value.upsert.return_value.execute = AsyncMock(side_effect=Exception("db down"))
    cb.set_db(db)

    async def failing():
        raise RuntimeError("provider error")

    # Should not raise DB error — circuit breaker absorbs it
    for _ in range(3):
        with pytest.raises(RuntimeError, match="provider error"):
            await cb.call(failing)

    assert cb.current_state() == "open"  # state machine still works in memory
