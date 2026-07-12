"use client";

import { useEffect, useState } from "react";
import { formatAirlineLabel, formatDuration, formatRelativeTime, sortFlights, type SearchResult, type SortKey } from "@/lib/api";
import type { SearchStatus } from "@/hooks/useSearch";
import AirlineIcon from "./AirlineIcon";
import TrackPriceAction from "./TrackPriceAction";
import ShareLinkButton from "./ShareLinkButton";
import FlightFilterBar from "./FlightFilterBar";
import FilteredEmptyState from "./FilteredEmptyState";
import { matchesFlightFilter, EMPTY_FLIGHT_FILTER, type FlightFilterState } from "@/lib/filterFlights";

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

/** RoundTripSegment 內部渲染用：外加篩選狀態（由父層 RoundTripResults 統一管理） */
interface SegmentRenderProps extends SegmentProps {
  filters: FlightFilterState;
  onClearFilters: () => void;
}

interface Props {
  outbound: SegmentProps;
  inbound: SegmentProps;
  total: number;
  onRetry: () => void;
  onTrackPrice?: (price: number) => Promise<void>;
}

function sourceLabel(source: string): string {
  if (source === "cache") return "快取";
  if (source === "fast_flights") return "Google Flights";
  return "Kiwi.com";
}

function RoundTripSegment({
  label, route, date, status, result, error, selected, sortBy, onSelect, filters, onClearFilters,
}: SegmentRenderProps) {
  // fullSorted 的排序與索引須與 useSearch.ts 內 sortedOutbound/sortedReturn 完全一致，
  // 因為 selected（連動總價計算）是「該排序陣列的索引」——篩選只能決定「顯示哪些項目」，
  // 不能改變索引意義，否則會選到別的航班、總價與畫面對不上。
  const fullSorted = result ? sortFlights(result.flights, sortBy) : [];
  const visible = fullSorted
    .map((flight, originalIdx) => ({ flight, originalIdx }))
    .filter(({ flight }) => matchesFlightFilter(flight, filters));
  const filteredOut = !!result && result.flights.length > 0 && visible.length === 0;

  return (
    <section
      aria-label={`${label}結果`}
      className="bg-white rounded-card border border-line shadow-card overflow-hidden"
    >
      <header className="px-5 py-3 bg-field border-b border-line-soft flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className="text-xs text-muted">{route}　{date}</p>
        </div>
        {result && (status === "success" || status === "stale") && (
          <span className="text-xs text-muted">
            {sourceLabel(result.source)}・{formatRelativeTime(result.fetched_at)}
            {status === "stale" && <span className="ml-2 text-[#B45309]">過期快取價</span>}
          </span>
        )}
      </header>

      <div className="p-4">
        {status === "loading" && (
          <div className="space-y-2" aria-label={`${label}載入中`}>
            {[0, 1].map((key) => (
              <div key={key} className="h-14 rounded-lg bg-field animate-pulse" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="text-center py-4">
            <p className="text-sm text-muted mb-1">{label}查詢失敗</p>
            {error && <p className="text-xs text-muted">{error}</p>}
          </div>
        )}

        {status === "empty" && (
          <p className="text-sm text-muted text-center py-4">
            這天沒有找到{label}航班，請換日期或鄰近機場試試
          </p>
        )}

        {(status === "success" || status === "stale") && filteredOut && (
          <FilteredEmptyState onClear={onClearFilters} />
        )}

        {(status === "success" || status === "stale") && visible.length > 0 && (
          <ul className="space-y-2" role="listbox" aria-label={`${label}報價選擇`}>
            {visible.map(({ flight, originalIdx }) => {
              const isSelected = originalIdx === Math.min(selected, fullSorted.length - 1);
              const airline = formatAirlineLabel(flight.airline, flight.flight_no);
              return (
                <li key={`${flight.airline}-${flight.flight_no}-${flight.depart_time}-${originalIdx}`}>
                  <div
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => onSelect(originalIdx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSelect(originalIdx);
                    }}
                    className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border
                               cursor-pointer transition-colors min-h-[56px] flex-wrap
                               ${isSelected
                                 ? "border-primary bg-primary/5 shadow-card"
                                 : "border-line hover:border-primary/40 hover:bg-field"}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        aria-hidden
                        className={`inline-block w-4 h-4 rounded-full border-2 shrink-0
                                   ${isSelected ? "border-primary bg-primary" : "border-line"}`}
                      />
                      <AirlineIcon code={airline.code} logoUrl={airline.logoUrl} name={airline.name} size="sm" />
                      <div className="min-w-0">
                        <div>
                          <div className="text-sm font-semibold text-ink">
                            {airline.name}
                          </div>
                          {airline.detail && (
                            <div className="mt-0.5 text-xs text-muted">{airline.detail}</div>
                          )}
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold text-ink">{flight.depart_time}</span>
                          <span className="text-xs text-muted"> — {formatDuration(flight.duration_min)} — </span>
                          <span className="font-semibold text-ink">{flight.arrive_time}</span>
                          <span className="text-xs text-muted">
                            {flight.stops === 0 ? "・直飛" : `・${flight.stops} 轉`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-lg font-bold text-price">
                        NT$ {flight.price.toLocaleString()}
                      </span>
                      {originalIdx === 0 && (
                        <span className="ml-2 text-xs font-bold text-price bg-price/10 ring-1 ring-price/25 px-2 py-0.5 rounded-full">
                          最便宜
                        </span>
                      )}
                      <a
                        href={flight.booking_hint}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block text-xs text-primary hover:underline mt-0.5"
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

export default function RoundTripResults({ outbound, inbound, total, onRetry, onTrackPrice }: Props) {
  const [filters, setFilters] = useState<FlightFilterState>(EMPTY_FLIGHT_FILTER);

  // 換一批新結果時（去程或回程的 result 參照改變）重置篩選狀態
  useEffect(() => {
    setFilters(EMPTY_FLIGHT_FILTER);
  }, [outbound.result, inbound.result]);

  const anyActivity = outbound.status !== "idle" || inbound.status !== "idle";
  if (!anyActivity) return null;

  const pricedCount =
    (outbound.result && outbound.result.flights.length > 0 ? 1 : 0) +
    (inbound.result && inbound.result.flights.length > 0 ? 1 : 0);

  const hasAnyFlights =
    (outbound.result?.flights.length ?? 0) > 0 || (inbound.result?.flights.length ?? 0) > 0;
  const combinedFlightsForOptions = [
    ...(outbound.result?.flights ?? []),
    ...(inbound.result?.flights ?? []),
  ];
  const clearFilters = () => setFilters(EMPTY_FLIGHT_FILTER);

  return (
    <div className="w-full max-w-3xl lg:max-w-6xl mx-auto space-y-5 mt-6">
      {hasAnyFlights && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <FlightFilterBar flights={combinedFlightsForOptions} filters={filters} onChange={setFilters} />
          <ShareLinkButton />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <RoundTripSegment {...outbound} filters={filters} onClearFilters={clearFilters} />
        <RoundTripSegment {...inbound} filters={filters} onClearFilters={clearFilters} />
      </div>

      <div
        aria-label="來回總價"
        className="bg-white rounded-card border-2 border-primary shadow-card px-5 py-4
                   flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <p className="text-sm font-semibold text-ink">
            已選 {pricedCount} / 2 段合計
          </p>
          {pricedCount < 2 && (
            <p className="text-xs text-[#B45309]">
              尚有航段無報價或查詢失敗，未計入完整來回總價
            </p>
          )}
        </div>
        <span className="text-2xl font-bold text-price">
          NT$ {total.toLocaleString()}
        </span>
      </div>

      {onTrackPrice && pricedCount === 2 && total > 0 && (
        <TrackPriceAction defaultPrice={total} onTrack={onTrackPrice} />
      )}

      {(outbound.status === "error" || inbound.status === "error") && (
        <div className="text-center">
          <button
            type="button"
            onClick={onRetry}
            className="px-5 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark
                       transition-colors min-h-[44px]"
          >
            重新查詢來回航班
          </button>
        </div>
      )}

      <p className="text-xs text-muted leading-relaxed">
        來回結果會分別查去程與回程，再加總目前選取的票價；實際是否為同一張來回票、
        退改規則與行李條件，仍以訂票頁顯示為準。
      </p>
    </div>
  );
}
