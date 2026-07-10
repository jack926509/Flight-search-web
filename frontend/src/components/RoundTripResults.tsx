"use client";

import { formatAirlineLabel, formatDuration, formatRelativeTime, sortFlights, type SearchResult, type SortKey } from "@/lib/api";
import type { SearchStatus } from "@/hooks/useSearch";

interface SegmentProps {
  label: string;
  route: string;
  date: string;
  status: SearchStatus;
  result: SearchResult | null;
  error: string | null;
  selected: number;
  sortBy: SortKey;
  onSelect: (idx: number) => void;
}

interface Props {
  outbound: SegmentProps;
  inbound: SegmentProps;
  total: number;
  onRetry: () => void;
}

function sourceLabel(source: string): string {
  if (source === "cache") return "快取";
  if (source === "fast_flights") return "Google Flights";
  return "Kiwi.com";
}

function RoundTripSegment({
  label, route, date, status, result, error, selected, sortBy, onSelect,
}: SegmentProps) {
  const sorted = result ? sortFlights(result.flights, sortBy) : [];

  return (
    <section
      aria-label={`${label}結果`}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden"
    >
      <header className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800">{label}</p>
          <p className="text-xs text-gray-500">{route}　{date}</p>
        </div>
        {result && (status === "success" || status === "stale") && (
          <span className="text-xs text-gray-400">
            {sourceLabel(result.source)}・{formatRelativeTime(result.fetched_at)}
            {status === "stale" && <span className="ml-2 text-[#B45309]">過期快取價</span>}
          </span>
        )}
      </header>

      <div className="p-4">
        {status === "loading" && (
          <div className="space-y-2" aria-label={`${label}載入中`}>
            {[0, 1].map((key) => (
              <div key={key} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-600 mb-1">{label}查詢失敗</p>
            {error && <p className="text-xs text-gray-400">{error}</p>}
          </div>
        )}

        {status === "empty" && (
          <p className="text-sm text-gray-500 text-center py-4">
            這天沒有找到{label}航班，請換日期或鄰近機場試試
          </p>
        )}

        {(status === "success" || status === "stale") && sorted.length > 0 && (
          <ul className="space-y-2" role="listbox" aria-label={`${label}報價選擇`}>
            {sorted.map((flight, idx) => {
              const isSelected = idx === Math.min(selected, sorted.length - 1);
              const airline = formatAirlineLabel(flight.airline, flight.flight_no);
              return (
                <li key={`${flight.airline}-${flight.flight_no}-${flight.depart_time}-${idx}`}>
                  <div
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => onSelect(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSelect(idx);
                    }}
                    className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border
                               cursor-pointer transition-colors min-h-[56px] flex-wrap
                               ${isSelected
                                 ? "border-[#0B5FFF] bg-blue-50"
                                 : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        aria-hidden
                        className={`inline-block w-4 h-4 rounded-full border-2 shrink-0
                                   ${isSelected ? "border-[#0B5FFF] bg-[#0B5FFF]" : "border-gray-300"}`}
                      />
                      <div className="min-w-0">
                        <div>
                          <div className="text-sm font-semibold text-gray-800">
                            {airline.name}
                          </div>
                          {airline.detail && (
                            <div className="mt-0.5 text-xs text-gray-400">{airline.detail}</div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {flight.depart_time} — {formatDuration(flight.duration_min)} — {flight.arrive_time}
                          {flight.stops === 0 ? "・直飛" : `・${flight.stops} 轉`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-lg font-bold text-[#0A7A3D]">
                        NT$ {flight.price.toLocaleString()}
                      </span>
                      {idx === 0 && (
                        <span className="ml-2 text-xs font-bold text-[#0A7A3D] bg-green-100 px-2 py-0.5 rounded-full">
                          最便宜
                        </span>
                      )}
                      <a
                        href={flight.booking_hint}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block text-xs text-[#0B5FFF] hover:underline mt-0.5"
                      >
                        查看訂票線索 →
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function RoundTripResults({ outbound, inbound, total, onRetry }: Props) {
  const anyActivity = outbound.status !== "idle" || inbound.status !== "idle";
  if (!anyActivity) return null;

  const pricedCount =
    (outbound.result && outbound.result.flights.length > 0 ? 1 : 0) +
    (inbound.result && inbound.result.flights.length > 0 ? 1 : 0);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-5 mt-6">
      <RoundTripSegment {...outbound} />
      <RoundTripSegment {...inbound} />

      <div
        aria-label="來回總價"
        className="bg-white rounded-xl border-2 border-[#0B5FFF] px-5 py-4
                   flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <p className="text-sm font-semibold text-gray-700">
            已選 {pricedCount} / 2 段合計
          </p>
          {pricedCount < 2 && (
            <p className="text-xs text-[#B45309]">
              尚有航段無報價或查詢失敗，未計入完整來回總價
            </p>
          )}
        </div>
        <span className="text-2xl font-bold text-[#0A7A3D]">
          NT$ {total.toLocaleString()}
        </span>
      </div>

      {(outbound.status === "error" || inbound.status === "error") && (
        <div className="text-center">
          <button
            type="button"
            onClick={onRetry}
            className="px-5 py-2 bg-[#0B5FFF] text-white rounded-lg hover:bg-blue-700
                       transition-colors min-h-[44px]"
          >
            重新查詢來回航班
          </button>
        </div>
      )}

      <p className="text-xs text-gray-400 leading-relaxed">
        來回結果會分別查去程與回程，再加總目前選取的票價；實際是否為同一張來回票、
        退改規則與行李條件，仍以訂票頁顯示為準。
      </p>
    </div>
  );
}
