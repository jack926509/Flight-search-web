"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFlights } from "@/lib/api";
import {
  BASELINE_STATION,
  MAX_SCAN_DAYS,
  MAX_SCAN_STATIONS,
  buildTasks,
  cellKey,
  datesInRange,
  decodeScanParams,
  encodeScanParams,
  type ScanCell,
} from "@/lib/stationScan";

/** 並發上限：與 useComboSearch 一致，維持 fast-flights 後端可承受的併發量 */
const CONCURRENCY = 2;
/**
 * 派工配速器：相鄰兩次 API 派發最小間隔（全域計，不分 worker）。
 * 真正的 429 風險在快取命中的快路徑（每筆 <1s，49 筆若無節流會在 25 秒內打完，超過後端 40/min 限流）；
 * 1.7 秒間隔換算尖峰吞吐約 35/min，留有安全餘裕，不改後端限流設定。
 */
const MIN_DISPATCH_INTERVAL_MS = 1700;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function useStationScan() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = isoLocal(new Date());
  const decoded = decodeScanParams(searchParams);

  const [dest, setDest] = useState(decoded.dest || "");
  const [fromDate, setFromDate] = useState(decoded.from || today);
  const [toDate, setToDate] = useState(decoded.to || today);
  const [stations, setStations] = useState<string[]>(decoded.stations);
  const [adults, setAdults] = useState(decoded.adults);
  const [cabin, setCabin] = useState(decoded.cabin);

  const [results, setResults] = useState<Record<string, ScanCell>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // 搜尋當下的條件快照：使用者改表單不影響已顯示的結果表
  const [snapshot, setSnapshot] = useState<{
    dest: string;
    stations: string[];
    dates: string[];
  } | null>(null);

  const requestIdRef = useRef(0);
  const autoSearchedRef = useRef(false);
  // 新一輪查詢開始前 abort 上一輪，讓後端協程與 fast-flights semaphore 及早釋放
  const abortControllerRef = useRef<AbortController | null>(null);
  // 全域派工節流用：上次派發時間＋序列化 gate（確保跨 worker 仍是同一節奏，不是各 worker 各自 1.7 秒）
  const lastDispatchRef = useRef(0);
  const dispatchGateRef = useRef<Promise<void>>(Promise.resolve());

  const dates = datesInRange(fromDate, toDate);
  const daysOk = dates.length > 0 && dates.length <= MAX_SCAN_DAYS;
  const stationsOk = stations.length > 0 && stations.length <= MAX_SCAN_STATIONS;
  const filled = !!dest && daysOk && stationsOk;
  const dayCount = dates.length;
  const queryCount = daysOk ? stations.length * dayCount + dayCount : 0;

  const waitForDispatchSlot = useCallback(async () => {
    // 序列化：每次呼叫都排在前一次之後，確保「全域」相鄰兩次派發間隔 ≥ MIN_DISPATCH_INTERVAL_MS
    const previous = dispatchGateRef.current;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    dispatchGateRef.current = gate;
    await previous;
    const elapsed = Date.now() - lastDispatchRef.current;
    const wait = MIN_DISPATCH_INTERVAL_MS - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastDispatchRef.current = Date.now();
    release();
  }, []);

  const searchOneCell = useCallback(
    async (
      station: string,
      date: string,
      d: string,
      a: number,
      c: string,
      reqId: number,
      signal: AbortSignal
    ) => {
      await waitForDispatchSlot();
      if (reqId !== requestIdRef.current) return;
      const key = cellKey(station, date);
      try {
        const data = await searchFlights(station, d, date, a, c, signal);
        if (reqId !== requestIdRef.current) return;
        setResults((prev) => ({
          ...prev,
          [key]: { status: data.flights.length > 0 ? "done" : "empty", flights: data.flights },
        }));
      } catch {
        if (reqId !== requestIdRef.current) return;
        setResults((prev) => ({ ...prev, [key]: { status: "error", flights: [] } }));
      } finally {
        if (reqId === requestIdRef.current) {
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
    },
    [waitForDispatchSlot]
  );

  const runSearch = useCallback(async () => {
    if (!filled) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const reqId = ++requestIdRef.current;

    const currentDates = datesInRange(fromDate, toDate);
    const tasks = buildTasks(stations, currentDates);

    setRunning(true);
    setProgress({ done: 0, total: tasks.length });
    setSnapshot({ dest, stations: [...stations], dates: currentDates });
    setResults(
      Object.fromEntries(
        tasks.map((t) => [cellKey(t.station, t.date), { status: "loading" as const, flights: [] }])
      )
    );

    const params = encodeScanParams({ dest, from: fromDate, to: toDate, stations, adults, cabin });
    router.replace(`?${params.toString()}`, { scroll: false });

    // 簡易 worker pool：同時最多 CONCURRENCY 個查詢，派發節奏另受 waitForDispatchSlot 節流
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        if (reqId !== requestIdRef.current) return; // 新一輪查詢已開始
        const t = tasks[next++];
        await searchOneCell(t.station, t.date, dest, adults, cabin, reqId, controller.signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
    if (reqId === requestIdRef.current) setRunning(false);
  }, [dest, stations, fromDate, toDate, adults, cabin, filled, router, searchOneCell]);

  // URL 直開 mode=scan 自動查詢（僅一次）
  useEffect(() => {
    if (autoSearchedRef.current) return;
    if (searchParams.get("mode") === "scan" && decoded.valid) {
      autoSearchedRef.current = true;
      runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    dest, setDest,
    fromDate, setFromDate,
    toDate, setToDate,
    stations, setStations,
    adults, setAdults,
    cabin, setCabin,
    results, running, progress, snapshot,
    runSearch, filled, daysOk, stationsOk, dayCount, queryCount,
    today,
    BASELINE_STATION,
  };
}
