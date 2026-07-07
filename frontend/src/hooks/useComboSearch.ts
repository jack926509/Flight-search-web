"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFlights, sortFlights, type Flight } from "@/lib/api";

/**
 * 外站組合比價：兩段（定位航段＋外站主票段）各設基準日期＋彈性 ±N 天，
 * 查出每個日期的最低價後，組成「段1日期 × 段2日期」總價矩陣。
 * 查詢數 = 段1日期數 + 段2日期數（線性），組合在客端計算（平方但零成本）。
 */
export interface ComboLeg {
  origin: string;
  dest: string;
  date: string; // 基準日期
  flex: number; // ±N 天（0–3）
}

export type DateStatus = "idle" | "loading" | "done" | "empty" | "error";

export interface DateResult {
  status: DateStatus;
  cheapest: Flight | null;
}

export const MAX_FLEX = 3;
/** 並發上限：fast-flights 後端 Semaphore(1)＋jitter，一次全發會讓尾端請求逾時 */
const CONCURRENCY = 2;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 基準日期 ± flex 天，過濾掉今天以前的日期（後端會 422） */
export function datesFor(leg: ComboLeg, today: string): string[] {
  const out: string[] = [];
  const base = new Date(`${leg.date}T12:00:00`);
  for (let delta = -leg.flex; delta <= leg.flex; delta++) {
    const d = new Date(base);
    d.setDate(d.getDate() + delta);
    const iso = isoLocal(d);
    if (iso >= today) out.push(iso);
  }
  return out;
}

function parseLegParam(raw: string | null): ComboLeg | null {
  // 格式：TPE-NRT@2026-08-06~2
  if (!raw) return null;
  const m = raw.match(/^([A-Z]{3})-([A-Z]{3})@(\d{4}-\d{2}-\d{2})~([0-3])$/);
  if (!m) return null;
  return { origin: m[1], dest: m[2], date: m[3], flex: Number(m[4]) };
}

function encodeLegParam(l: ComboLeg): string {
  return `${l.origin}-${l.dest}@${l.date}~${l.flex}`;
}

export function useComboSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const now = new Date();
  const today = isoLocal(now);

  const urlA = parseLegParam(searchParams.get("a"));
  const urlB = parseLegParam(searchParams.get("b"));

  const [legA, setLegA] = useState<ComboLeg>(
    urlA ?? { origin: "TPE", dest: "", date: today, flex: 1 }
  );
  const [legB, setLegB] = useState<ComboLeg>(
    urlB ?? { origin: "", dest: "TPE", date: today, flex: 1 }
  );
  const [adults, setAdults] = useState(
    Math.max(1, Math.min(9, Number(searchParams.get("adults")) || 1))
  );
  const [cabin, setCabin] = useState(searchParams.get("cabin") || "economy");

  const [resultsA, setResultsA] = useState<Record<string, DateResult>>({});
  const [resultsB, setResultsB] = useState<Record<string, DateResult>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // 搜尋當下的條件快照：使用者改表單不影響已顯示的矩陣
  const [snapshot, setSnapshot] = useState<{
    legA: ComboLeg; legB: ComboLeg; datesA: string[]; datesB: string[];
  } | null>(null);

  const requestIdRef = useRef(0);
  const autoSearchedRef = useRef(false);

  const filled = !!(legA.origin && legA.dest && legA.date && legB.origin && legB.dest && legB.date);

  const searchOneDate = useCallback(
    async (
      which: "A" | "B",
      leg: ComboLeg,
      date: string,
      a: number,
      c: string,
      reqId: number
    ) => {
      const setResults = which === "A" ? setResultsA : setResultsB;
      try {
        const data = await searchFlights(leg.origin, leg.dest, date, a, c);
        if (reqId !== requestIdRef.current) return;
        const cheapest =
          data.flights.length > 0 ? sortFlights(data.flights, "price")[0] : null;
        setResults((prev) => ({
          ...prev,
          [date]: { status: cheapest ? "done" : "empty", cheapest },
        }));
      } catch {
        if (reqId !== requestIdRef.current) return;
        setResults((prev) => ({ ...prev, [date]: { status: "error", cheapest: null } }));
      } finally {
        if (reqId === requestIdRef.current) {
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
    },
    []
  );

  const runSearch = useCallback(async () => {
    if (!filled) return;
    const reqId = ++requestIdRef.current;

    const dA = datesFor(legA, today);
    const dB = datesFor(legB, today);
    const tasks: Array<{ which: "A" | "B"; leg: ComboLeg; date: string }> = [
      ...dA.map((date) => ({ which: "A" as const, leg: legA, date })),
      ...dB.map((date) => ({ which: "B" as const, leg: legB, date })),
    ];

    setRunning(true);
    setProgress({ done: 0, total: tasks.length });
    setSnapshot({ legA: { ...legA }, legB: { ...legB }, datesA: dA, datesB: dB });
    setResultsA(Object.fromEntries(dA.map((d) => [d, { status: "loading" as DateStatus, cheapest: null }])));
    setResultsB(Object.fromEntries(dB.map((d) => [d, { status: "loading" as DateStatus, cheapest: null }])));

    const p = new URLSearchParams({
      mode: "combo",
      a: encodeLegParam(legA),
      b: encodeLegParam(legB),
      adults: String(adults),
      cabin,
    });
    router.replace(`?${p.toString()}`, { scroll: false });

    // 簡易 worker pool：同時最多 CONCURRENCY 個查詢
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        if (reqId !== requestIdRef.current) return; // 新一輪查詢已開始
        const t = tasks[next++];
        await searchOneDate(t.which, t.leg, t.date, adults, cabin, reqId);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker)
    );
    if (reqId === requestIdRef.current) setRunning(false);
  }, [legA, legB, adults, cabin, filled, today, router, searchOneDate]);

  // URL 直開 mode=combo 自動查詢（僅一次）
  useEffect(() => {
    if (autoSearchedRef.current) return;
    if (
      searchParams.get("mode") === "combo" &&
      parseLegParam(searchParams.get("a")) &&
      parseLegParam(searchParams.get("b"))
    ) {
      autoSearchedRef.current = true;
      runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    legA, setLegA, legB, setLegB,
    adults, setAdults, cabin, setCabin,
    resultsA, resultsB, running, progress, snapshot,
    runSearch, filled,
    today,
  };
}
