"use client";

import { useEffect, useState } from "react";
import { fetchHealth, type HealthStatus } from "@/lib/api";

export type HealthLevel = "ok" | "degraded" | "down";

/**
 * 系統狀態燈的真實資料源：定期打 /api/health（免 token）。
 * ok       — 後端 200 且 DB 正常（或未設 DB）
 * degraded — 後端 200 但 DB ping 失敗（快取／歷史失效，即時查詢仍可用）
 * down     — 後端不可達
 */
export interface HealthSnapshot extends HealthStatus {
  level: HealthLevel;
}

const INITIAL_HEALTH: HealthSnapshot = {
  level: "ok",
  ok: true,
  db: null,
  providers: {},
  schedulers: {},
};

export function useHealth(intervalMs = 60_000): HealthSnapshot {
  const [health, setHealth] = useState<HealthSnapshot>(INITIAL_HEALTH);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const h = await fetchHealth();
      if (cancelled) return;
      const providerIssue = Object.values(h.providers).some((provider) => !provider.reachable);
      const schedulerIssue = Object.values(h.schedulers).some((scheduler) => scheduler.last_status === "failed");
      const level: HealthLevel = !h.ok ? "down" : h.db === false || providerIssue || schedulerIssue ? "degraded" : "ok";
      setHealth({ ...h, level });
    };

    check();
    const timer = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return health;
}
