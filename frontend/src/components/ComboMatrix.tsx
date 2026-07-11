"use client";

import { useState } from "react";
import { formatAirlineLabel, formatDuration } from "@/lib/api";
import type { Flight } from "@/lib/api";
import type { ComboLeg, DateResult } from "@/hooks/useComboSearch";
import AirlineIcon from "./AirlineIcon";

interface Props {
  snapshot: {
    legA: ComboLeg;
    legB: ComboLeg;
    datesA: string[];
    datesB: string[];
  } | null;
  resultsA: Record<string, DateResult>;
  resultsB: Record<string, DateResult>;
  running: boolean;
  progress: { done: number; total: number };
}

function mmdd(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

function CheapestDetail({ label, date, flight }: { label: string; date: string; flight: Flight }) {
  const airline = formatAirlineLabel(flight.airline, flight.flight_no);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-gray-50 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <AirlineIcon code={airline.code} logoUrl={airline.logoUrl} name={airline.name} size="sm" />
        <div className="min-w-0">
          <p className="text-xs text-gray-400">{label}・{date}</p>
          <p className="text-sm font-semibold text-gray-800">
            {airline.name}
            {airline.detail && <span className="ml-1 text-xs text-gray-400">{airline.detail}</span>}
            <span className="ml-2 font-normal text-gray-500">
              {flight.depart_time} — {formatDuration(flight.duration_min)} — {flight.arrive_time}
              {flight.stops === 0 ? "・直飛" : `・${flight.stops} 轉`}
            </span>
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <span className="text-lg font-bold text-[#0A7A3D]">
          NT$ {flight.price.toLocaleString()}
        </span>
        <a
          href={flight.booking_hint}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-primary hover:underline"
        >
          在 Google Flights 查看 →
        </a>
      </div>
    </div>
  );
}

export default function ComboMatrix({
  snapshot, resultsA, resultsB, running, progress,
}: Props) {
  const [picked, setPicked] = useState<{ a: string; b: string } | null>(null);

  if (!snapshot || progress.total === 0) return null;
  const { legA, legB, datesA, datesB } = snapshot;

  // 找出可行組合中的最低總價（段2日期不得早於段1日期）
  let best: { a: string; b: string; total: number } | null = null;
  for (const da of datesA) {
    for (const db of datesB) {
      if (db < da) continue;
      const ra = resultsA[da];
      const rb = resultsB[db];
      if (ra?.cheapest && rb?.cheapest) {
        const total = ra.cheapest.price + rb.cheapest.price;
        if (!best || total < best.total) best = { a: da, b: db, total };
      }
    }
  }

  const pickedA = picked && resultsA[picked.a]?.cheapest;
  const pickedB = picked && resultsB[picked.b]?.cheapest;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4 mt-6">
      {/* Progress */}
      {running && (
        <div
          role="status"
          className="flex items-center gap-3 px-4 py-3 rounded-card bg-blue-50 border border-blue-100 text-sm text-primary"
        >
          <span className="animate-spin inline-block w-4 h-4 border-2 border-primary
                           border-t-transparent rounded-full shrink-0" />
          組合比價中：已完成 {progress.done} / {progress.total} 個日期查詢（結果逐格填入）
        </div>
      )}

      {/* Matrix */}
      <div className="bg-white rounded-card border border-gray-200 shadow-card p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">
          組合總價矩陣
          <span className="ml-2 text-xs font-normal text-gray-400">
            列＝段1（{legA.origin}→{legA.dest}）・欄＝段2（{legB.origin}→{legB.dest}）・以各段當日最低價加總
          </span>
        </p>
        <div className="overflow-x-auto">
          <table aria-label="組合價格矩陣" className="w-full text-sm border-collapse min-w-[420px]">
            <thead>
              <tr>
                <th className="p-2 text-xs text-gray-400 font-normal text-left whitespace-nowrap">
                  段1 ↓ ／ 段2 →
                </th>
                {datesB.map((db) => (
                  <th key={db} className="p-2 text-xs text-gray-500 font-semibold whitespace-nowrap">
                    {mmdd(db)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datesA.map((da) => (
                <tr key={da}>
                  <th className="p-2 text-xs text-gray-500 font-semibold text-left whitespace-nowrap">
                    {mmdd(da)}
                  </th>
                  {datesB.map((db) => {
                    const invalid = db < da;
                    const ra = resultsA[da];
                    const rb = resultsB[db];
                    const loading =
                      ra?.status === "loading" || rb?.status === "loading";
                    const failed = ra?.status === "error" || rb?.status === "error";
                    const noFlight = ra?.status === "empty" || rb?.status === "empty";
                    const total =
                      ra?.cheapest && rb?.cheapest
                        ? ra.cheapest.price + rb.cheapest.price
                        : null;
                    const isBest = !!best && best.a === da && best.b === db;
                    const isPicked = picked?.a === da && picked?.b === db;

                    let content: string;
                    if (invalid) content = "—";
                    else if (loading) content = "…";
                    else if (failed) content = "✕";
                    else if (noFlight) content = "無班";
                    else content = total !== null ? total.toLocaleString() : "…";

                    return (
                      <td key={db} className="p-1 text-center">
                        <button
                          type="button"
                          disabled={invalid || total === null}
                          onClick={() => setPicked({ a: da, b: db })}
                          aria-label={
                            invalid
                              ? `${mmdd(da)} 去 ${mmdd(db)} 回：不可行（回程早於去程）`
                              : total !== null
                                ? `${mmdd(da)} 去 ${mmdd(db)} 回 總價 NT$ ${total.toLocaleString()}`
                                : `${mmdd(da)} 去 ${mmdd(db)} 回：查詢中`
                          }
                          className={`w-full px-2 py-2 rounded-lg text-sm min-h-[40px] transition-colors
                            ${invalid ? "text-gray-300 cursor-not-allowed" : ""}
                            ${!invalid && total === null ? "text-gray-400" : ""}
                            ${total !== null && !isBest && !isPicked ? "hover:bg-blue-50 text-gray-700 cursor-pointer" : ""}
                            ${isBest && !isPicked ? "bg-price/15 text-price ring-1 ring-price/30 font-bold" : ""}
                            ${isPicked ? "bg-primary text-white font-bold" : ""}`}
                        >
                          {content}
                          {isBest && !isPicked && (
                            <span className="block text-[10px] font-normal">最低</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          「—」＝段2日期早於段1，不可行；「無班」＝該日查無航班；「✕」＝該日查詢失敗（重新比價即重試）。
          點任一格查看兩段航班明細。
        </p>
      </div>

      {/* Best summary */}
      {best && !running && (
        <div
          aria-label="最佳組合"
          className="bg-white rounded-card border-2 border-price shadow-card px-5 py-4
                     flex items-center justify-between flex-wrap gap-3"
        >
          <p className="text-sm font-semibold text-gray-700">
            🏆 最低組合：{mmdd(best.a)} 去＋{mmdd(best.b)} 回
          </p>
          <span className="text-2xl font-bold text-[#0A7A3D]">
            NT$ {best.total.toLocaleString()}
          </span>
        </div>
      )}

      {/* Picked combo detail */}
      {picked && pickedA && pickedB && (
        <div
          aria-label="組合明細"
          className="bg-white rounded-card border border-gray-200 shadow-card p-4 space-y-2"
        >
          <p className="text-sm font-semibold text-gray-700">
            組合明細：{mmdd(picked.a)} 去＋{mmdd(picked.b)} 回＝
            <span className="text-[#0A7A3D] font-bold">
              　NT$ {(pickedA.price + pickedB.price).toLocaleString()}
            </span>
          </p>
          <CheapestDetail
            label={`段1　${legA.origin} → ${legA.dest}`}
            date={picked.a}
            flight={pickedA}
          />
          <CheapestDetail
            label={`段2　${legB.origin} → ${legB.dest}`}
            date={picked.b}
            flight={pickedB}
          />
          <p className="text-xs text-gray-400">
            以各段當日最低價計；欲改選其他航班，可切到「多段行程」模式帶入這兩個日期細選。
          </p>
        </div>
      )}

      <p className="text-xs text-gray-400 leading-relaxed">
        ⚠ 外站票提醒：兩段為獨立機票，行李需重掛、前段延誤後段不負責改補；
        外站出發的來回票須從第一段開始按順序使用，跳段（no-show）會使後續航段被取消。
        比價結果為查詢當下快照，訂票前請以訂票頁實際價格為準。
      </p>
    </div>
  );
}
