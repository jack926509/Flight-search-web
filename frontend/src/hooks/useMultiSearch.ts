"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFlights, sortFlights, type SearchResult } from "@/lib/api";

/** 多段行程（外站票／四腿票）：2–4 段獨立單程，各自查詢、加總報價 */
export interface Leg {
  origin: string;
  dest: string;
  date: string;
}

export type LegStatus = "idle" | "loading" | "success" | "empty" | "error" | "stale";

export interface LegState {
  status: LegStatus;
  result: SearchResult | null;
  error: string | null;
  /** 已選報價：price 排序後的索引，預設 0（最便宜） */
  selected: number;
}

export const MIN_LEGS = 2;
export const MAX_LEGS = 4;

const EMPTY_LEG_STATE: LegState = { status: "idle", result: null, error: null, selected: 0 };

function parseLegsParam(raw: string | null): Leg[] | null {
  // 格式：TPE-NRT@2026-08-06|NRT-TPE@2026-08-20
  if (!raw) return null;
  const legs: Leg[] = [];
  for (const part of raw.split("|")) {
    const m = part.match(/^([A-Z]{3})-([A-Z]{3})@(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    legs.push({ origin: m[1], dest: m[2], date: m[3] });
  }
  if (legs.length < MIN_LEGS || legs.length > MAX_LEGS) return null;
  return legs;
}

function encodeLegsParam(legs: Leg[]): string {
  return legs.map((l) => `${l.origin}-${l.dest}@${l.date}`).join("|");
}

export function useMultiSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const urlLegs = parseLegsParam(searchParams.get("legs"));
  const [legs, setLegs] = useState<Leg[]>(
    urlLegs ?? [
      { origin: "TPE", dest: "", date: today },
      { origin: "", dest: "TPE", date: today },
    ]
  );
  const [legStates, setLegStates] = useState<LegState[]>(
    (urlLegs ?? [null, null]).map(() => ({ ...EMPTY_LEG_STATE }))
  );
  const [adults, setAdults] = useState(
    Math.max(1, Math.min(9, Number(searchParams.get("adults")) || 1))
  );
  const [cabin, setCabin] = useState(searchParams.get("cabin") || "economy");
  const [searching, setSearching] = useState(false);

  const requestIdRef = useRef(0);
  // 初次載入若 URL 帶 mode=multi&legs=… 自動查詢（只觸發一次）
  const autoSearchedRef = useRef(false);
  // 新一輪查詢開始前 abort 上一輪，讓後端協程與 fast-flights semaphore 及早釋放（M4）
  const abortControllerRef = useRef<AbortController | null>(null);

  const updateLeg = (idx: number, patch: Partial<Leg>) => {
    setLegs((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLeg = () => {
    setLegs((prev) => {
      if (prev.length >= MAX_LEGS) return prev;
      const last = prev[prev.length - 1];
      // 體驗：新航段預設從上一段的目的地出發、同日期
      return [...prev, { origin: last.dest, dest: "", date: last.date }];
    });
    setLegStates((prev) =>
      prev.length >= MAX_LEGS ? prev : [...prev, { ...EMPTY_LEG_STATE }]
    );
  };

  const removeLeg = (idx: number) => {
    setLegs((prev) => (prev.length <= MIN_LEGS ? prev : prev.filter((_, i) => i !== idx)));
    setLegStates((prev) =>
      prev.length <= MIN_LEGS ? prev : prev.filter((_, i) => i !== idx)
    );
  };

  const allLegsFilled = legs.every((l) => l.origin && l.dest && l.date);

  const searchOneLeg = useCallback(
    async (idx: number, leg: Leg, a: number, c: string, reqId: number, signal?: AbortSignal) => {
      try {
        const data = await searchFlights(leg.origin, leg.dest, leg.date, a, c, signal);
        if (reqId !== requestIdRef.current) return;
        setLegStates((prev) =>
          prev.map((s, i) =>
            i === idx
              ? {
                  status: data.flights.length === 0 ? "empty" : data.stale ? "stale" : "success",
                  result: data,
                  error: null,
                  selected: 0,
                }
              : s
          )
        );
      } catch (e) {
        if (reqId !== requestIdRef.current) return;
        setLegStates((prev) =>
          prev.map((s, i) =>
            i === idx
              ? {
                  status: "error",
                  result: null,
                  error: e instanceof Error ? e.message : "查詢失敗",
                  selected: 0,
                }
              : s
          )
        );
      }
    },
    []
  );

  const searchAll = useCallback(async () => {
    if (!allLegsFilled) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const reqId = ++requestIdRef.current;
    setSearching(true);
    setLegStates(legs.map(() => ({ ...EMPTY_LEG_STATE, status: "loading" as LegStatus })));

    const p = new URLSearchParams({
      mode: "multi",
      legs: encodeLegsParam(legs),
      adults: String(adults),
      cabin,
    });
    router.replace(`?${p.toString()}`, { scroll: false });

    // 各段並行發出、各自完成即各自顯示（後端 Semaphore 會自然節流 fast-flights）
    await Promise.all(legs.map((leg, i) => searchOneLeg(i, leg, adults, cabin, reqId, controller.signal)));
    if (reqId === requestIdRef.current) setSearching(false);
  }, [legs, adults, cabin, allLegsFilled, router, searchOneLeg]);

  const retryLeg = (idx: number) => {
    const reqId = requestIdRef.current; // 不作廢其他段的結果
    setLegStates((prev) =>
      prev.map((s, i) => (i === idx ? { ...EMPTY_LEG_STATE, status: "loading" } : s))
    );
    searchOneLeg(idx, legs[idx], adults, cabin, reqId, abortControllerRef.current?.signal);
  };

  const selectFlight = (legIdx: number, flightIdx: number) => {
    setLegStates((prev) =>
      prev.map((s, i) => (i === legIdx ? { ...s, selected: flightIdx } : s))
    );
  };

  // 總價：只加總已有報價的段（price 排序後取 selected）
  const pricedLegs = legStates.filter(
    (s) => (s.status === "success" || s.status === "stale") && s.result
  );
  const total = legStates.reduce((sum, s) => {
    if ((s.status !== "success" && s.status !== "stale") || !s.result) return sum;
    const sorted = sortFlights(s.result.flights, "price");
    const chosen = sorted[Math.min(s.selected, sorted.length - 1)];
    return sum + (chosen?.price ?? 0);
  }, 0);
  const unpricedCount = legs.length - pricedLegs.length;

  // URL 直開 mode=multi&legs=… 自動查詢（僅一次）
  useEffect(() => {
    if (autoSearchedRef.current) return;
    if (searchParams.get("mode") === "multi" && parseLegsParam(searchParams.get("legs"))) {
      autoSearchedRef.current = true;
      searchAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    legs, updateLeg, addLeg, removeLeg,
    legStates, retryLeg, selectFlight,
    adults, setAdults, cabin, setCabin,
    searching, searchAll, allLegsFilled,
    total, unpricedCount,
    today,
  };
}
