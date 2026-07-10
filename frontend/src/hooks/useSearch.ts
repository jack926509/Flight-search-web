"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFlights, sortFlights, type SearchResult, type SortKey } from "@/lib/api";

export type SearchStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error"
  | "stale";

export type TripType = "one-way" | "round-trip";

export interface SearchState {
  origin: string;
  dest: string;
  date: string;
  adults: number;
  cabin: string;
  tripType: TripType;
  returnDate: string;
  status: SearchStatus;
  result: SearchResult | null;
  returnStatus: SearchStatus;
  returnResult: SearchResult | null;
  returnError: string | null;
  error: string | null;
  sortBy: SortKey;
  selectedOutbound: number;
  selectedReturn: number;
}

export function useSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Local date (not toISOString/UTC — in UTC+8 early morning that returns yesterday)
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const [origin, setOrigin] = useState(searchParams.get("origin") || "TPE");
  const [dest, setDest] = useState(searchParams.get("dest") || "");
  const [date, setDate] = useState(searchParams.get("date") || today);
  const [returnDate, setReturnDate] = useState(
    searchParams.get("returnDate") || searchParams.get("return_date") || searchParams.get("ret") || today
  );
  const [tripType, setTripType] = useState<TripType>(
    searchParams.get("trip") === "round-trip" ? "round-trip" : "one-way"
  );
  const [adults, setAdults] = useState(
    Math.max(1, Math.min(9, Number(searchParams.get("adults")) || 1))
  );
  const [cabin, setCabin] = useState(
    searchParams.get("cabin") || "economy"
  );
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [returnStatus, setReturnStatus] = useState<SearchStatus>("idle");
  const [returnResult, setReturnResult] = useState<SearchResult | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("price");
  const [selectedOutbound, setSelectedOutbound] = useState(0);
  const [selectedReturn, setSelectedReturn] = useState(0);

  // Monotonic id so a slow earlier response can't overwrite a newer one
  const requestIdRef = useRef(0);

  const pushUrl = useCallback(
    (o: string, d: string, dt: string, a: number, c: string, trip: TripType, ret?: string) => {
      const p = new URLSearchParams({
        origin: o,
        dest: d,
        date: dt,
        adults: String(a),
        cabin: c,
      });
      if (trip === "round-trip") {
        p.set("trip", "round-trip");
        if (ret) p.set("returnDate", ret);
      }
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [router]
  );

  const statusForResult = (data: SearchResult): SearchStatus => {
    if (data.flights.length === 0) return "empty";
    if (data.stale) return "stale";
    return "success";
  };

  const doSearch = useCallback(
    async (o: string, d: string, dt: string, a: number, c: string) => {
      if (!o || !d || !dt) return;
      const reqId = ++requestIdRef.current;
      setStatus("loading");
      setResult(null);
      setReturnStatus("idle");
      setReturnResult(null);
      setReturnError(null);
      setSelectedOutbound(0);
      setSelectedReturn(0);
      setError(null);
      pushUrl(o, d, dt, a, c, "one-way");

      try {
        const data = await searchFlights(o, d, dt, a, c);
        if (reqId !== requestIdRef.current) return; // superseded by a newer search
        setStatus(statusForResult(data));
        setResult(data);
      } catch (e) {
        if (reqId !== requestIdRef.current) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "查詢失敗");
      }
    },
    [pushUrl]
  );

  const doRoundTripSearch = useCallback(
    async (o: string, d: string, dt: string, ret: string, a: number, c: string) => {
      if (!o || !d || !dt || !ret) return;
      const reqId = ++requestIdRef.current;
      setStatus("loading");
      setReturnStatus("loading");
      setResult(null);
      setReturnResult(null);
      setError(null);
      setReturnError(null);
      setSelectedOutbound(0);
      setSelectedReturn(0);
      pushUrl(o, d, dt, a, c, "round-trip", ret);

      const [outbound, inbound] = await Promise.allSettled([
        searchFlights(o, d, dt, a, c),
        searchFlights(d, o, ret, a, c),
      ]);
      if (reqId !== requestIdRef.current) return;

      if (outbound.status === "fulfilled") {
        setStatus(statusForResult(outbound.value));
        setResult(outbound.value);
      } else {
        setStatus("error");
        setError(outbound.reason instanceof Error ? outbound.reason.message : "去程查詢失敗");
      }

      if (inbound.status === "fulfilled") {
        setReturnStatus(statusForResult(inbound.value));
        setReturnResult(inbound.value);
      } else {
        setReturnStatus("error");
        setReturnError(inbound.reason instanceof Error ? inbound.reason.message : "回程查詢失敗");
      }
    },
    [pushUrl]
  );

  // Auto-search on initial load if all required params present
  useEffect(() => {
    const o = searchParams.get("origin");
    const d = searchParams.get("dest");
    const dt = searchParams.get("date");
    const ret = searchParams.get("returnDate") || searchParams.get("return_date") || searchParams.get("ret") || "";
    const a = Number(searchParams.get("adults")) || 1;
    const c = searchParams.get("cabin") || "economy";
    const trip = searchParams.get("trip") === "round-trip" ? "round-trip" : "one-way";
    if (o && d && dt) {
      setOrigin(o);
      setDest(d);
      setDate(dt);
      setTripType(trip);
      if (ret) setReturnDate(ret);
      setAdults(a);
      setCabin(c);
      if (trip === "round-trip" && ret) {
        doRoundTripSearch(o, d, dt, ret, a, c);
      } else {
        doSearch(o, d, dt, a, c);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => {
    if (tripType === "round-trip") {
      doRoundTripSearch(origin, dest, date, returnDate, adults, cabin);
      return;
    }
    doSearch(origin, dest, date, adults, cabin);
  };

  const swapAirports = () => {
    setOrigin(dest);
    setDest(origin);
  };

  const retry = () => {
    if (tripType === "round-trip") {
      doRoundTripSearch(origin, dest, date, returnDate, adults, cabin);
      return;
    }
    doSearch(origin, dest, date, adults, cabin);
  };

  const goDate = (delta: number) => {
    // Anchor at noon so the ±1-day shift never crosses a date line in any timezone
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const pad = (n: number) => String(n).padStart(2, "0");
    const newDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setDate(newDate);
    doSearch(origin, dest, newDate, adults, cabin);
  };

  const sortedOutbound = result ? sortFlights(result.flights, sortBy) : [];
  const sortedReturn = returnResult ? sortFlights(returnResult.flights, sortBy) : [];
  const outboundChoice = sortedOutbound[Math.min(selectedOutbound, sortedOutbound.length - 1)];
  const returnChoice = sortedReturn[Math.min(selectedReturn, sortedReturn.length - 1)];
  const roundTripTotal = (outboundChoice?.price ?? 0) + (returnChoice?.price ?? 0);

  return {
    origin, setOrigin,
    dest, setDest,
    date, setDate,
    tripType, setTripType,
    returnDate, setReturnDate,
    adults, setAdults,
    cabin, setCabin,
    status, result, error,
    returnStatus, returnResult, returnError,
    sortBy, setSortBy,
    selectedOutbound, setSelectedOutbound,
    selectedReturn, setSelectedReturn,
    roundTripTotal,
    handleSubmit, swapAirports, retry, goDate,
    today,
  };
}
