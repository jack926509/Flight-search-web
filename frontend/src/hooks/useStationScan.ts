"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cancelStationScan, createStationScan, getStationScan, type StationScanResponse } from "@/lib/stationScans";
import {
  BASELINE_STATION, MAX_SCAN_DAYS, MAX_SCAN_STATIONS, cellKey, datesInRange,
  decodeScanParams, encodeScanParams, type ScanCell,
} from "@/lib/stationScan";

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function isoLocal(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

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
  const [snapshot, setSnapshot] = useState<{ dest: string; stations: string[]; dates: string[] } | null>(null);
  const [jobId, setJobId] = useState(searchParams.get("scanJob") || "");
  const loadedJobRef = useRef("");

  const dates = useMemo(() => datesInRange(fromDate, toDate), [fromDate, toDate]);
  const daysOk = dates.length > 0 && dates.length <= MAX_SCAN_DAYS;
  const stationsOk = stations.length > 0 && stations.length <= MAX_SCAN_STATIONS;
  const filled = !!dest && daysOk && stationsOk;
  const dayCount = dates.length;
  const queryCount = daysOk ? stations.length * dayCount + dayCount : 0;

  const applyResponse = useCallback((response: StationScanResponse) => {
    const jobStations = response.job.stations || [];
    const jobDates = datesInRange(response.job.from_date, response.job.to_date);
    setSnapshot({ dest: response.job.dest, stations: jobStations, dates: jobDates });
    setResults(Object.fromEntries(response.cells.map((cell) => [
      cellKey(cell.station, cell.departure_date),
      { status: cell.status === "pending" || cell.status === "running" ? "loading" : cell.status, flights: cell.flights || [] },
    ])));
    setProgress({ done: response.done ?? response.cells.filter((cell) => ["done", "empty", "error"].includes(cell.status)).length, total: response.total });
    setRunning(["pending", "running"].includes(response.job.status));
  }, []);

  const loadJob = useCallback(async (id: string) => {
    const response = await getStationScan(id);
    applyResponse(response);
    return response;
  }, [applyResponse]);

  const runSearch = useCallback(async () => {
    if (!filled) return;
    const response = await createStationScan({ dest, from_date: fromDate, to_date: toDate, stations, adults, cabin });
    setJobId(response.job.id);
    loadedJobRef.current = response.job.id;
    applyResponse(response);
    const params = encodeScanParams({ dest, from: fromDate, to: toDate, stations, adults, cabin });
    params.set("scanJob", response.job.id);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [adults, applyResponse, cabin, dest, filled, fromDate, router, stations, toDate]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    await cancelStationScan(jobId);
    await loadJob(jobId);
  }, [jobId, loadJob]);

  useEffect(() => {
    if (!jobId || loadedJobRef.current === jobId) return;
    loadedJobRef.current = jobId;
    void loadJob(jobId).catch(() => setRunning(false));
  }, [jobId, loadJob]);

  useEffect(() => {
    if (!jobId || !running) return;
    const timer = setInterval(() => void loadJob(jobId).catch(() => setRunning(false)), 3_000);
    return () => clearInterval(timer);
  }, [jobId, loadJob, running]);

  return {
    dest, setDest, fromDate, setFromDate, toDate, setToDate, stations, setStations, adults, setAdults, cabin, setCabin,
    results, running, progress, snapshot, runSearch, cancel, filled, daysOk, stationsOk, dayCount, queryCount, today, BASELINE_STATION,
  };
}
