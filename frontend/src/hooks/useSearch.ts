"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchFlights, type SearchResult, type SortKey } from "@/lib/api";

export type SearchStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error"
  | "stale";

export interface SearchState {
  origin: string;
  dest: string;
  date: string;
  adults: number;
  cabin: string;
  status: SearchStatus;
  result: SearchResult | null;
  error: string | null;
  sortBy: SortKey;
}

export function useSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const today = new Date().toISOString().split("T")[0];

  const [origin, setOrigin] = useState(searchParams.get("origin") || "TPE");
  const [dest, setDest] = useState(searchParams.get("dest") || "");
  const [date, setDate] = useState(searchParams.get("date") || today);
  const [adults, setAdults] = useState(
    Math.max(1, Math.min(9, Number(searchParams.get("adults")) || 1))
  );
  const [cabin, setCabin] = useState(
    searchParams.get("cabin") || "economy"
  );
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("price");

  const abortRef = useRef<AbortController | null>(null);

  const pushUrl = useCallback(
    (o: string, d: string, dt: string, a: number, c: string) => {
      const p = new URLSearchParams({
        origin: o,
        dest: d,
        date: dt,
        adults: String(a),
        cabin: c,
      });
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [router]
  );

  const doSearch = useCallback(
    async (o: string, d: string, dt: string, a: number, c: string) => {
      if (!o || !d || !dt) return;
      abortRef.current?.abort();
      setStatus("loading");
      setResult(null);
      setError(null);
      pushUrl(o, d, dt, a, c);

      try {
        const data = await searchFlights(o, d, dt, a, c);
        if (data.flights.length === 0) {
          setStatus("empty");
        } else if (data.stale) {
          setStatus("stale");
        } else {
          setStatus("success");
        }
        setResult(data);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "查詢失敗");
      }
    },
    [pushUrl]
  );

  // Auto-search on initial load if all required params present
  useEffect(() => {
    const o = searchParams.get("origin");
    const d = searchParams.get("dest");
    const dt = searchParams.get("date");
    const a = Number(searchParams.get("adults")) || 1;
    const c = searchParams.get("cabin") || "economy";
    if (o && d && dt) {
      setOrigin(o);
      setDest(d);
      setDate(dt);
      setAdults(a);
      setCabin(c);
      doSearch(o, d, dt, a, c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => doSearch(origin, dest, date, adults, cabin);

  const swapAirports = () => {
    setOrigin(dest);
    setDest(origin);
  };

  const retry = () => doSearch(origin, dest, date, adults, cabin);

  const goDate = (delta: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    const newDate = d.toISOString().split("T")[0];
    setDate(newDate);
    doSearch(origin, dest, newDate, adults, cabin);
  };

  return {
    origin, setOrigin,
    dest, setDest,
    date, setDate,
    adults, setAdults,
    cabin, setCabin,
    status, result, error,
    sortBy, setSortBy,
    handleSubmit, swapAirports, retry, goDate,
    today,
  };
}
