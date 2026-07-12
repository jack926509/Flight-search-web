"use client";

import AirportInput from "./AirportInput";
import { MAX_LEGS, MIN_LEGS, type Leg } from "@/hooks/useMultiSearch";

interface Props {
  legs: Leg[];
  adults: number;
  cabin: string;
  today: string;
  searching: boolean;
  allLegsFilled: boolean;
  onLegChange: (idx: number, patch: Partial<Leg>) => void;
  onAddLeg: () => void;
  onRemoveLeg: (idx: number) => void;
  onAdultsChange: (v: number) => void;
  onCabinChange: (v: string) => void;
  onSubmit: () => void;
}

const CABINS = [
  { value: "economy", label: "經濟艙" },
  { value: "premium-economy", label: "豪華經濟" },
  { value: "business", label: "商務艙" },
  { value: "first", label: "頭等艙" },
];

export default function MultiSearchCard({
  legs, adults, cabin, today, searching, allLegsFilled,
  onLegChange, onAddLeg, onRemoveLeg, onAdultsChange, onCabinChange, onSubmit,
}: Props) {
  return (
    <div className="bg-white rounded-card shadow-card border border-line-soft p-6 w-full max-w-3xl mx-auto">
      <p className="text-xs text-muted mb-4">
        外站票／四腿票：每段為獨立單程機票，各段分別查價後加總。
      </p>

      {/* Leg rows */}
      <div className="space-y-4 mb-4">
        {legs.map((leg, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <span className="text-xs font-bold text-muted w-10 shrink-0 mb-3">
              第 {i + 1} 段
            </span>
            <div className="flex-1 min-w-[120px]">
              <AirportInput
                id={`leg${i}-origin`}
                label="出發地"
                value={leg.origin}
                onChange={(v) => onLegChange(i, { origin: v })}
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <AirportInput
                id={`leg${i}-dest`}
                label="目的地"
                value={leg.dest}
                onChange={(v) => onLegChange(i, { dest: v })}
              />
            </div>
            <div className="min-w-[140px]">
              <label
                htmlFor={`leg${i}-date`}
                className="block text-xs font-medium text-muted mb-1"
              >
                日期
              </label>
              <input
                id={`leg${i}-date`}
                type="date"
                value={leg.date}
                min={today}
                onChange={(e) => onLegChange(i, { date: e.target.value })}
                className="w-full px-3 py-3 border border-line rounded-lg text-sm bg-white
                           focus:border-primary focus:ring-1 focus:ring-primary outline-none
                           min-h-[44px]"
              />
            </div>
            {legs.length > MIN_LEGS && (
              <button
                type="button"
                onClick={() => onRemoveLeg(i)}
                aria-label={`移除第 ${i + 1} 段`}
                className="mb-1 p-2 rounded-full border border-line text-muted
                           hover:bg-red-50 hover:text-red-500 hover:border-red-300
                           transition-colors shrink-0 min-h-[44px] min-w-[44px]"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {legs.length < MAX_LEGS && (
        <button
          type="button"
          onClick={onAddLeg}
          className="mb-5 text-sm text-primary hover:underline min-h-[44px] px-1"
        >
          ＋ 新增航段（最多 {MAX_LEGS} 段）
        </button>
      )}

      {/* Shared: adults + cabin */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="w-24">
          <label htmlFor="multi-adults" className="block text-xs font-medium text-muted mb-1">
            人數
          </label>
          <select
            id="multi-adults"
            value={adults}
            onChange={(e) => onAdultsChange(Number(e.target.value))}
            className="w-full px-3 py-3 border border-line rounded-lg text-sm bg-white
                       focus:border-primary focus:ring-1 focus:ring-primary outline-none
                       min-h-[44px]"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n} 人</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[130px]">
          <label htmlFor="multi-cabin" className="block text-xs font-medium text-muted mb-1">
            艙等
          </label>
          <select
            id="multi-cabin"
            value={cabin}
            onChange={(e) => onCabinChange(e.target.value)}
            className="w-full px-3 py-3 border border-line rounded-lg text-sm bg-white
                       focus:border-primary focus:ring-1 focus:ring-primary outline-none
                       min-h-[44px]"
          >
            {CABINS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={searching || !allLegsFilled}
        className={`w-full font-semibold py-3 px-6 rounded-xl transition-all min-h-[48px]
                   flex items-center justify-center gap-2
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                   ${searching
                     ? "bg-primary text-white shadow-card"
                     : !allLegsFilled
                       ? "bg-field text-muted border border-line cursor-not-allowed"
                       : "bg-primary text-white shadow-card hover:bg-primary-dark hover:shadow-cardHover"}`}
      >
        {searching ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white
                             border-t-transparent rounded-full" />
            各段查詢中…
          </>
        ) : (
          `✈ 查詢 ${legs.length} 段行程`
        )}
      </button>
    </div>
  );
}
