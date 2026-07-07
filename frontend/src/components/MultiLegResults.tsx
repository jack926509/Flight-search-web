"use client";

import { formatDuration, sortFlights, formatRelativeTime } from "@/lib/api";
import type { Leg, LegState } from "@/hooks/useMultiSearch";

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
  const anyActivity = legStates.some((s) => s.status !== "idle");
  if (!anyActivity) return null;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-5 mt-6">
      {legs.map((leg, i) => {
        const s = legStates[i];
        const sorted = s.result ? sortFlights(s.result.flights, "price") : [];
        return (
          <section
            key={i}
            aria-label={`第 ${i + 1} 段結果`}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <header className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-semibold text-gray-700">
                第 {i + 1} 段　{leg.origin} → {leg.dest}　{leg.date}
              </span>
              {s.result && (s.status === "success" || s.status === "stale") && (
                <span className="text-xs text-gray-400">
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
                    <div key={k} className="h-12 rounded-lg bg-gray-100 animate-pulse" />
                  ))}
                </div>
              )}

              {s.status === "error" && (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-600 mb-1">此段查詢失敗</p>
                  {s.error && <p className="text-xs text-gray-400 mb-3">{s.error}</p>}
                  <button
                    type="button"
                    onClick={() => onRetryLeg(i)}
                    className="px-4 py-2 text-sm bg-[#0B5FFF] text-white rounded-lg
                               hover:bg-blue-700 transition-colors min-h-[44px]"
                  >
                    重試此段
                  </button>
                </div>
              )}

              {s.status === "empty" && (
                <p className="text-sm text-gray-500 text-center py-4">
                  🔍 這天沒有找到航班——換個日期或鄰近機場試試
                </p>
              )}

              {(s.status === "success" || s.status === "stale") && sorted.length > 0 && (
                <ul className="space-y-2" role="listbox" aria-label={`第 ${i + 1} 段報價選擇`}>
                  {sorted.map((f, fi) => {
                    const isSelected = fi === Math.min(s.selected, sorted.length - 1);
                    return (
                      <li key={`${f.airline}-${f.flight_no}-${f.depart_time}-${fi}`}>
                        <div
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={0}
                          onClick={() => onSelectFlight(i, fi)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") onSelectFlight(i, fi);
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
                              <span className="text-sm font-semibold text-gray-800">
                                {f.airline}
                                {f.flight_no && (
                                  <span className="ml-1 text-xs text-gray-400">{f.flight_no}</span>
                                )}
                              </span>
                              <div className="text-xs text-gray-500">
                                {f.depart_time} — {formatDuration(f.duration_min)} —{" "}
                                {f.arrive_time}
                                {f.stops === 0 ? "・直飛" : `・${f.stops} 轉`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-lg font-bold text-[#0A7A3D]">
                              NT$ {f.price.toLocaleString()}
                            </span>
                            {fi === 0 && (
                              <span className="ml-2 text-xs font-bold text-[#0A7A3D] bg-green-100 px-2 py-0.5 rounded-full">
                                最便宜
                              </span>
                            )}
                            <a
                              href={f.booking_hint}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="block text-xs text-[#0B5FFF] hover:underline mt-0.5"
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
        className="bg-white rounded-xl border-2 border-[#0B5FFF] px-5 py-4
                   flex items-center justify-between flex-wrap gap-3"
      >
        <div>
          <p className="text-sm font-semibold text-gray-700">
            已選 {legs.length - unpricedCount} / {legs.length} 段合計
          </p>
          {unpricedCount > 0 && (
            <p className="text-xs text-[#B45309]">
              尚有 {unpricedCount} 段無報價（查詢中／失敗／無航班），未計入總價
            </p>
          )}
        </div>
        <span className="text-2xl font-bold text-[#0A7A3D]">
          NT$ {total.toLocaleString()}
        </span>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        ⚠ 分段購票提醒：各段為<strong>互不相關的獨立機票</strong>——行李需逐段重掛、
        前段延誤導致後段誤機時航空公司不負責改補；請預留充足轉機時間（建議 4
        小時以上或隔夜）、確認中停地的簽證／過境規定，並注意外站出發票須從第一段
        開始按順序使用。
      </p>
    </div>
  );
}
