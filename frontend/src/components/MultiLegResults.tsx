"use client";

import { useEffect, useState } from "react";
import { formatAirlineLabel, formatDuration, sortFlights, formatRelativeTime } from "@/lib/api";
import type { Leg, LegState } from "@/hooks/useMultiSearch";
import AirlineIcon from "./AirlineIcon";
import ShareLinkButton from "./ShareLinkButton";
import FlightFilterBar from "./FlightFilterBar";
import FilteredEmptyState from "./FilteredEmptyState";
import { matchesFlightFilter, EMPTY_FLIGHT_FILTER, type FlightFilterState } from "@/lib/filterFlights";

interface Props {
  legs: Leg[];
  legStates: LegState[];
  total: number;
  unpricedCount: number;
  onRetryLeg: (idx: number) => void;
  onSelectFlight: (legIdx: number, flightIdx: number) => void;
}

export default function MultiLegResults({
  legs, legStates, total, unpricedCount, onRetryLeg, onSelectFlight,
}: Props) {
  const [filters, setFilters] = useState<FlightFilterState>(EMPTY_FLIGHT_FILTER);
  const clearFilters = () => setFilters(EMPTY_FLIGHT_FILTER);

  // 換一批新結果時重置篩選狀態。用 fetched_at 組字串當 key（而非 legStates 陣列本身參照），
  // 避免使用者只是點選某個報價（selectFlight 也會換新的 legStates 參照）就誤觸重置。
  const resultsKey = legStates.map((s) => s.result?.fetched_at ?? "").join("|");
  useEffect(() => {
    setFilters(EMPTY_FLIGHT_FILTER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsKey]);

  const anyActivity = legStates.some((s) => s.status !== "idle");
  if (!anyActivity) return null;

  const hasAnyFlights = legStates.some((s) => (s.result?.flights.length ?? 0) > 0);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-5 mt-6">
      {hasAnyFlights && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <FlightFilterBar
            flights={[]}
            filters={filters}
            onChange={setFilters}
            showAirlineFilter={false}
            showTimeFilter={false}
          />
          <ShareLinkButton />
        </div>
      )}

      {legs.map((leg, i) => {
        const s = legStates[i];
        // fullSorted 的排序須與 useMultiSearch.ts 內 total 計算用的 sortFlights(...,"price")
        // 完全一致，因為 s.selected 是「該排序陣列的索引」；篩選只能決定顯示哪些項目。
        const fullSorted = s.result ? sortFlights(s.result.flights, "price") : [];
        const visible = fullSorted
          .map((flight, originalIdx) => ({ flight, originalIdx }))
          .filter(({ flight }) => matchesFlightFilter(flight, filters));
        const filteredOut = !!s.result && s.result.flights.length > 0 && visible.length === 0;
        return (
          <section
            key={i}
            aria-label={`第 ${i + 1} 段結果`}
            className="bg-white rounded-card border border-line shadow-card overflow-hidden"
          >
            <header className="px-5 py-3 bg-field border-b border-line-soft flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-semibold text-ink">
                第 {i + 1} 段　{leg.origin} → {leg.dest}　{leg.date}
              </span>
              {s.result && (s.status === "success" || s.status === "stale") && (
                <span className="text-xs text-muted">
                  {s.result.source === "cache" ? "快取" : s.result.source === "fast_flights" ? "Google Flights" : "Kiwi.com"}
                  ・{formatRelativeTime(s.result.fetched_at)}
                  {s.status === "stale" && (
                    <span className="ml-2 text-[#B45309]">⚠ 過期快取價</span>
                  )}
                </span>
              )}
            </header>

            <div className="p-4">
              {s.status === "loading" && (
                <div className="space-y-2" aria-label="載入中">
                  {[0, 1].map((k) => (
                    <div key={k} className="h-12 rounded-lg bg-field animate-pulse" />
                  ))}
                </div>
              )}

              {s.status === "error" && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted mb-1">此段查詢失敗</p>
                  {s.error && <p className="text-xs text-muted mb-3">{s.error}</p>}
                  <button
                    type="button"
                    onClick={() => onRetryLeg(i)}
                    className="px-4 py-2 text-sm bg-primary text-white rounded-lg
                               hover:bg-primary-dark transition-colors min-h-[44px]"
                  >
                    重試此段
                  </button>
                </div>
              )}

              {s.status === "empty" && (
                <p className="text-sm text-muted text-center py-4">
                  🔍 這天沒有找到航班——換個日期或鄰近機場試試
                </p>
              )}

              {(s.status === "success" || s.status === "stale") && filteredOut && (
                <FilteredEmptyState onClear={clearFilters} />
              )}

              {(s.status === "success" || s.status === "stale") && visible.length > 0 && (
                <ul className="space-y-2" role="listbox" aria-label={`第 ${i + 1} 段報價選擇`}>
                  {visible.map(({ flight: f, originalIdx }) => {
                    const isSelected = originalIdx === Math.min(s.selected, fullSorted.length - 1);
                    const airline = formatAirlineLabel(f.airline, f.flight_no);
                    return (
                      <li key={`${f.airline}-${f.flight_no}-${f.depart_time}-${originalIdx}`}>
                        <div
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={0}
                          onClick={() => onSelectFlight(i, originalIdx)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") onSelectFlight(i, originalIdx);
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
                              <div className="text-xs text-muted">
                                {f.depart_time} — {formatDuration(f.duration_min)} —{" "}
                                {f.arrive_time}
                                {f.stops === 0 ? "・直飛" : `・${f.stops} 轉`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-lg font-bold text-price">
                              NT$ {f.price.toLocaleString()}
                            </span>
                            {originalIdx === 0 && (
                              <span className="ml-2 text-xs font-bold text-price bg-price/10 ring-1 ring-price/25 px-2 py-0.5 rounded-full">
                                最便宜
                              </span>
                            )}
                            <a
                              href={f.booking_hint}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="block text-xs text-primary hover:underline mt-0.5"
                            >
                              在 Google Flights 查看 →
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
      })}

      {/* Total bar */}
      <div
        aria-label="多段總價"
        className="bg-white rounded-card border-2 border-primary shadow-card px-5 py-4
                   flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <p className="text-sm font-semibold text-ink">
            已選 {legs.length - unpricedCount} / {legs.length} 段合計
          </p>
          {unpricedCount > 0 && (
            <p className="text-xs text-[#B45309]">
              尚有 {unpricedCount} 段無報價（查詢中／失敗／無航班），未計入總價
            </p>
          )}
        </div>
        <span className="text-2xl font-bold text-price">
          NT$ {total.toLocaleString()}
        </span>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        ⚠ 分段購票提醒：各段為<strong>互不相關的獨立機票</strong>——行李需逐段重掛、
        前段延誤導致後段誤機時航空公司不負責改補；請預留充足轉機時間（建議 4
        小時以上或隔夜）、確認中停地的簽證／過境規定，並注意外站出發票須從第一段
        開始按順序使用。
      </p>
    </div>
  );
}
