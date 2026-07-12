"""Circuit Breaker — 依附錄 E 審定規格實作，純手寫不引第三方庫。"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from enum import Enum

logger = logging.getLogger(__name__)

_UTC = timezone.utc
_FAILURE_THRESHOLD = 3  # E1: 連續失敗達 3 次 → OPEN（固定，不可調）


class CBState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpen(Exception):
    """Circuit is OPEN or HALF_OPEN probe is busy — caller should skip this provider."""


class CircuitBreaker:
    """
    狀態機（E1 唯一合法轉換）：
      CLOSED ──失敗≥3──▶ OPEN
      OPEN ──冷卻期滿──▶ HALF_OPEN
      HALF_OPEN ──試探成功──▶ CLOSED（failure_count 歸零）
      HALF_OPEN ──試探失敗──▶ OPEN（重新起算冷卻）
      CLOSED 成功 ──▶ failure_count 歸零
    """

    def __init__(self, provider_name: str, cooldown_seconds: int | None = None) -> None:
        self._name = provider_name
        self._cooldown = cooldown_seconds if cooldown_seconds is not None else int(os.getenv("CB_COOLDOWN_SECONDS", "300"))
        self._state = CBState.CLOSED
        self._failure_count = 0
        self._opened_at: datetime | None = None
        self._probe_lock = asyncio.Lock()
        self._db = None  # set via set_db() after lifespan DB init

    def set_db(self, db) -> None:
        self._db = db

    # ── State queries (sync — called from both sync and async contexts) ───────

    def _check_cooldown(self) -> None:
        """Lazily transition OPEN → HALF_OPEN when cooldown elapses (no await needed)."""
        if (
            self._state == CBState.OPEN
            and self._opened_at is not None
            and (datetime.now(_UTC) - self._opened_at).total_seconds() >= self._cooldown
        ):
            self._state = CBState.HALF_OPEN
            logger.info(
                "circuit_breaker provider=%s from_state=open to_state=half_open "
                "failure_count=%d reason=cooldown_elapsed",
                self._name, self._failure_count,
            )

    def is_open(self) -> bool:
        self._check_cooldown()
        return self._state == CBState.OPEN

    def is_half_open_probing(self) -> bool:
        """True when HALF_OPEN and a probe is already in flight."""
        self._check_cooldown()
        return self._state == CBState.HALF_OPEN and self._probe_lock.locked()

    def current_state(self) -> str:
        self._check_cooldown()
        return self._state.value

    # ── Main entry point ──────────────────────────────────────────────────────

    async def call(self, fn, *args, **kwargs):
        """
        Wrap a provider.search() call.
        Raises CircuitBreakerOpen if circuit is OPEN or probe is busy (E4).
        """
        self._check_cooldown()

        if self._state == CBState.OPEN:
            raise CircuitBreakerOpen(f"{self._name} circuit is OPEN")

        if self._state == CBState.HALF_OPEN:
            # No await between locked() check and async-with → atomic in asyncio (E4)
            if self._probe_lock.locked():
                raise CircuitBreakerOpen(f"{self._name} HALF_OPEN probe is busy")
            async with self._probe_lock:
                return await self._run_probe(fn, *args, **kwargs)

        # CLOSED — normal call
        try:
            result = await fn(*args, **kwargs)
            await self._on_success()
            return result
        except Exception as exc:
            await self._on_failure(exc)
            raise

    # ── Private: success / failure / probe ───────────────────────────────────

    async def _run_probe(self, fn, *args, **kwargs):
        try:
            result = await fn(*args, **kwargs)
            # Probe succeeded → CLOSED (E1)
            self._transition(CBState.CLOSED, "probe_success")
            self._failure_count = 0
            await self._persist()
            return result
        except Exception as exc:
            # Probe failed → OPEN, restart cooldown (E1)
            self._transition(CBState.OPEN, "probe_failure")
            await self._persist(error=exc)
            raise

    async def _on_success(self) -> None:
        if self._failure_count > 0:
            self._failure_count = 0
            await self._persist()

    async def _on_failure(self, exc: Exception) -> None:
        self._failure_count += 1
        if self._failure_count >= _FAILURE_THRESHOLD:
            self._transition(CBState.OPEN, f"failure_count_reached_{self._failure_count}")
        await self._persist(error=exc)

    def _transition(self, new_state: CBState, reason: str) -> None:
        old_state = self._state
        self._state = new_state
        if new_state == CBState.OPEN:
            self._opened_at = datetime.now(_UTC)
        elif new_state == CBState.CLOSED:
            self._failure_count = 0
            self._opened_at = None
        logger.info(
            "circuit_breaker provider=%s from_state=%s to_state=%s "
            "failure_count=%d reason=%s",
            self._name, old_state.value, new_state.value, self._failure_count, reason,
        )

    # ── Persistence (E6: DB 是輔助，Supabase 故障不得讓熔斷器故障) ──────────

    async def _persist(self, error: Exception | None = None) -> None:
        if self._db is None:
            return
        payload = {
            "provider": self._name,
            "state": self._state.value,
            "failure_count": self._failure_count,
            "opened_at": self._opened_at.isoformat() if self._opened_at else None,
        }
        # Only touch last_success_at on success — a failure must not wipe it to NULL
        if self._state == CBState.CLOSED and self._failure_count == 0:
            payload["last_success_at"] = datetime.now(_UTC).isoformat()
        if error is not None:
            payload["last_failure_at"] = datetime.now(_UTC).isoformat()
            payload["last_error"] = str(error)[:240]
        try:
            await self._db.table("provider_status").upsert(
                payload,
                on_conflict="provider",
            ).execute()
        except Exception as exc:
            logger.warning("circuit_breaker persist failed (non-fatal): %s", exc)

    async def load_from_db(self) -> None:
        """E6: 啟動時自 DB 載入，依冷卻是否已過決定啟動狀態。"""
        if self._db is None:
            return
        try:
            resp = (
                await self._db.table("provider_status")
                .select("state,failure_count,opened_at")
                .eq("provider", self._name)
                .limit(1)
                .execute()
            )
            if not resp.data:
                return
            row = resp.data[0]
            state_str = row.get("state", "closed")
            fc = row.get("failure_count", 0)
            opened_at_str = row.get("opened_at")

            if state_str == "open" and opened_at_str:
                opened_at = datetime.fromisoformat(opened_at_str)
                if not opened_at.tzinfo:
                    opened_at = opened_at.replace(tzinfo=_UTC)
                elapsed = (datetime.now(_UTC) - opened_at).total_seconds()
                if elapsed >= self._cooldown:
                    self._state = CBState.HALF_OPEN
                    self._failure_count = fc
                    self._opened_at = opened_at
                    logger.info(
                        "circuit_breaker %s restored as HALF_OPEN (cooldown elapsed at startup)", self._name
                    )
                else:
                    self._state = CBState.OPEN
                    self._failure_count = fc
                    self._opened_at = opened_at
                    logger.info(
                        "circuit_breaker %s restored as OPEN (%.0fs remaining)",
                        self._name, self._cooldown - elapsed,
                    )
            else:
                self._state = CBState.CLOSED
                self._failure_count = 0
        except Exception as exc:
            logger.warning("circuit_breaker load_from_db failed (non-fatal): %s", exc)
