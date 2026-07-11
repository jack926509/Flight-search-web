"use client";

import FlightCard from "./FlightCard";
import LoadingSkeleton from "./LoadingSkeleton";
import PriceTrendSection from "./PriceTrendChart";
import TrackPriceAction from "./TrackPriceAction";
import { sortFlights, formatRelativeTime, type SortKey } from "@/lib/api";
import type { SearchResult } from "@/lib/api";
import type { SearchStatus } from "@/hooks/useSearch";

const SORT_TABS: { key: SortKey; label: string }[] = [
  { key: "price", label: "最低價" },
  { key: "duration", label: "最短時間" },
  { key: "depart", label: "最早起飛" },
];

interface Props {
  status: SearchStatus;
  result: SearchResult | null;
  error: string | null;
  sortBy: SortKey;
  origin: string;
  dest: string;
  onSortChange: (k: SortKey) => void;
  onRetry: () => void;
  onGoDate: (delta: number) => void;
  onTrackPrice?: (price: number) => Promise<void>;
}

export default function ResultsSection({
  status, result, error, sortBy, origin, dest,
  onSortChange, onRetry, onGoDate, onTrackPrice,
}: Props) {
  if (status === "idle") return null;

  const route = `${origin}-${dest}`;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4 mt-6">
      {/* Stale banner */}
      {status === "stale" && result && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl
                     bg-[#FEF3C7] border border-[#B45309] text-[#B45309] text-sm"
        >
          <span>
            ⚠ 即時查詢暫時無法使用，以下為{" "}
            {formatRelativeTime(result.fetched_at)} 的快取資料
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="underline hover:no-underline shrink-0 min-h-[44px] px-2"
          >
            重新嘗試
          </button>
        </div>
      )}

      {/* Loading */}
      {status === "loading" && <LoadingSkeleton />}

      {/* Error */}
      {status === "error" && (
        <div
          role="alert"
          className="flex flex-col items-center gap-4 py-12 text-center"
        >
          <span className="text-4xl">✈️</span>
          <p className="text-gray-600">查詢失敗，請稍後再試</p>
          {error && (
            <p className="text-xs text-gray-400 max-w-xs">{error}</p>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="px-5 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark
                       transition-colors min-h-[44px]"
          >
            重試
          </button>
        </div>
      )}

      {/* Empty */}
      {status === "empty" && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="text-4xl">🔍</span>
          <p className="text-gray-600">這天沒有找到航班</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onGoDate(-1)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50
                         transition-colors min-h-[44px]"
            >
              ← 查前一天
            </button>
            <button
              type="button"
              onClick={() => onGoDate(1)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50
                         transition-colors min-h-[44px]"
            >
              查後一天 →
            </button>
          </div>
        </div>
      )}

      {/* Success / Stale results */}
      {(status === "success" || status === "stale") && result && result.flights.length > 0 && (
        <>
          {/* Sort tabs */}
          <div
            role="tablist"
            aria-label="排序方式"
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {SORT_TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={sortBy === tab.key}
                type="button"
                onClick={() => onSortChange(tab.key)}
                className={`px-4 py-2 rounded-full text-sm font-medium shrink-0 min-h-[44px]
                  transition-all ${
                    sortBy === tab.key
                      ? "bg-cta-gradient text-white shadow-card"
                      : "bg-white/70 backdrop-blur border border-gray-200 text-gray-600 hover:bg-white hover:border-accent/40"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Source info */}
          <p className="text-xs text-gray-400">
            資料來源：{result.source === "cache" ? "快取" : result.source === "fast_flights" ? "Google Flights" : "Kiwi.com"}
            ・{formatRelativeTime(result.fetched_at)}
          </p>

          {onTrackPrice && (
            <TrackPriceAction
              defaultPrice={sortFlights(result.flights, "price")[0].price}
              onTrack={onTrackPrice}
            />
          )}

          {/* Cards */}
          <div className="space-y-3">
            {sortFlights(result.flights, sortBy).map((f, i) => (
              <FlightCard
                key={`${f.flight_no}-${f.depart_time}-${i}`}
                flight={f}
                cheapest={i === 0 && sortBy === "price"}
              />
            ))}
          </div>

          {/* Price trend */}
          <PriceTrendSection route={route} />
        </>
      )}
    </div>
  );
}
