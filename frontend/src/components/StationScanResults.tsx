"use client";

import { useMemo } from "react";
import { computeRows, type ScanCell, type ScanGrade } from "@/lib/stationScan";
import ShareLinkButton from "./ShareLinkButton";

interface Props {
  snapshot: {
    dest: string;
    stations: string[];
    dates: string[];
  } | null;
  results: Record<string, ScanCell>;
  running: boolean;
  progress: { done: number; total: number };
}

function mmdd(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

function GradeBadge({ grade }: { grade: ScanGrade | null }) {
  if (grade === null) {
    return (
      <span className="inline-block text-[11px] font-medium text-muted bg-field border border-line
                       px-2 py-0.5 rounded-full">
        計算中
      </span>
    );
  }
  if (grade === "best") {
    return (
      <span className="inline-block text-[11px] font-bold text-green bg-green-soft
                       px-2 py-0.5 rounded-full">
        🟢 底價
      </span>
    );
  }
  if (grade === "normal") {
    return (
      <span className="inline-block text-[11px] font-bold text-warning bg-warning-bg
                       px-2 py-0.5 rounded-full">
        🟡 一般
      </span>
    );
  }
  return (
    <span className="inline-block text-[11px] font-bold text-red-600 bg-red-50
                     px-2 py-0.5 rounded-full">
      🔴 偏高
    </span>
  );
}

export default function StationScanResults({ snapshot, results, running, progress }: Props) {
  const done = progress.total > 0 && progress.done === progress.total;

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return computeRows(results, snapshot.stations, snapshot.dates, done);
  }, [snapshot, results, done]);

  if (!snapshot || progress.total === 0) return null;

  const hasAnyResult = rows.length > 0;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4 mt-6">
      {hasAnyResult && (
        <div className="flex justify-end">
          <ShareLinkButton />
        </div>
      )}

      {/* Progress */}
      {running && (
        <div
          role="status"
          className="flex items-center gap-3 px-4 py-3 rounded-card bg-accent-soft border border-line text-sm text-primary"
        >
          <span className="animate-spin inline-block w-4 h-4 border-2 border-primary
                           border-t-transparent rounded-full shrink-0" />
          外站範圍掃描中：已完成 {progress.done} / {progress.total} 筆查詢（結果逐格填入）
        </div>
      )}

      <div className="bg-white rounded-card border border-line shadow-card p-4">
        <p className="text-sm font-semibold text-ink mb-3">
          外站範圍掃描結果
          <span className="ml-2 text-xs font-normal text-muted">
            目的地 {snapshot.dest}・依價格由低到高排序・分級基準為全體最低價
          </span>
        </p>

        {!hasAnyResult ? (
          <p className="text-sm text-muted py-4 text-center">尚無結果，查詢中或全數查無航班</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="外站範圍掃描結果" className="w-full text-sm border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="p-2 text-xs text-muted font-normal text-left whitespace-nowrap">排名</th>
                  <th className="p-2 text-xs text-muted font-normal text-left whitespace-nowrap">價格</th>
                  <th className="p-2 text-xs text-muted font-normal text-left whitespace-nowrap">轉機/直飛</th>
                  <th className="p-2 text-xs text-muted font-normal text-left whitespace-nowrap">路徑</th>
                  <th className="p-2 text-xs text-muted font-normal text-left whitespace-nowrap">出發日</th>
                  <th className="p-2 text-xs text-muted font-normal text-left whitespace-nowrap">VS 直飛</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={`${row.station}-${row.date}`}
                    className={`border-b border-line-soft last:border-0 ${row.isBaseline ? "bg-field" : ""}`}
                  >
                    <td className="p-2 text-xs text-muted whitespace-nowrap">{idx + 1}</td>
                    <td className="p-2 whitespace-nowrap">
                      <a
                        href={row.flight.booking_hint}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-price hover:underline"
                        title="在 Google Flights 查看與訂票"
                      >
                        NT$ {row.flight.price.toLocaleString()}
                      </a>
                      <span className="block mt-0.5">
                        <GradeBadge grade={row.grade} />
                      </span>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {row.flight.stops === 0 ? (
                        <span className="text-xs text-green bg-green-soft px-2 py-0.5 rounded-full">
                          直飛
                        </span>
                      ) : (
                        <span className="text-xs text-muted bg-field px-2 py-0.5 rounded-full">
                          {row.flight.stops} 轉
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-sm text-ink whitespace-nowrap">
                      {row.station} → {snapshot.dest}
                      {row.isBaseline && (
                        <span className="ml-1.5 text-[11px] text-muted">（直飛基準）</span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-muted whitespace-nowrap">{mmdd(row.date)}</td>
                    <td className="p-2 text-xs whitespace-nowrap">
                      {row.isBaseline ? (
                        <span className="text-muted">——</span>
                      ) : row.vsDirect ? (
                        <span className={row.vsDirect.diff <= 0 ? "text-green font-semibold" : "text-muted"}>
                          {row.vsDirect.label}
                          {row.vsDirect.approximate && (
                            <span title="當日查無直飛，以最便宜轉機價估算" className="ml-0.5 text-muted">＊</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted mt-3">
          🟢 底價＝對全體最低價 5% 以內；🟡 一般＝15% 以內；🔴 偏高＝超過 15%。
          「＊」＝當日查無直飛，VS 直飛以最便宜轉機價估算。掃描未完成時徽章顯示「計算中」，全部完成後才定案。
        </p>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        ⚠ 比價結果為查詢當下快照，訂票前請以訂票頁實際價格為準；不同出發站之間為各自獨立機票，行程規劃請自行確認銜接與退換規定。
      </p>
    </div>
  );
}
