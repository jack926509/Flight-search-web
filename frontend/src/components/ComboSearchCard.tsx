"use client";

import AirportInput from "./AirportInput";
import { datesFor, MAX_FLEX, type ComboLeg } from "@/hooks/useComboSearch";

interface Props {
  legA: ComboLeg;
  legB: ComboLeg;
  adults: number;
  cabin: string;
  today: string;
  running: boolean;
  filled: boolean;
  onLegAChange: (l: ComboLeg) => void;
  onLegBChange: (l: ComboLeg) => void;
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

function LegRow({
  title, hint, leg, today, onChange, idPrefix,
}: {
  title: string;
  hint: string;
  leg: ComboLeg;
  today: string;
  onChange: (l: ComboLeg) => void;
  idPrefix: string;
}) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-500 mb-2">
        {title}
        <span className="ml-2 font-normal text-gray-400">{hint}</span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[120px]">
          <AirportInput
            id={`${idPrefix}-origin`}
            label="出發地"
            value={leg.origin}
            onChange={(v) => onChange({ ...leg, origin: v })}
          />
        </div>
        <div className="flex-1 min-w-[120px]">
          <AirportInput
            id={`${idPrefix}-dest`}
            label="目的地"
            value={leg.dest}
            onChange={(v) => onChange({ ...leg, dest: v })}
          />
        </div>
        <div className="min-w-[140px]">
          <label
            htmlFor={`${idPrefix}-date`}
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            基準日期
          </label>
          <input
            id={`${idPrefix}-date`}
            type="date"
            value={leg.date}
            min={today}
            onChange={(e) => onChange({ ...leg, date: e.target.value })}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-accent focus:ring-1 focus:ring-accent outline-none
                       min-h-[44px]"
          />
        </div>
        <div className="w-28">
          <label
            htmlFor={`${idPrefix}-flex`}
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            彈性天數
          </label>
          <select
            id={`${idPrefix}-flex`}
            value={leg.flex}
            onChange={(e) => onChange({ ...leg, flex: Number(e.target.value) })}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-accent focus:ring-1 focus:ring-accent outline-none
                       min-h-[44px]"
          >
            {Array.from({ length: MAX_FLEX + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n === 0 ? "僅當天" : `± ${n} 天`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export default function ComboSearchCard({
  legA, legB, adults, cabin, today, running, filled,
  onLegAChange, onLegBChange, onAdultsChange, onCabinChange, onSubmit,
}: Props) {
  const totalQueries =
    (filled ? datesFor(legA, today).length + datesFor(legB, today).length : 0);

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-card shadow-card border border-white/60 p-6 w-full max-w-3xl mx-auto">
      <p className="text-xs text-gray-400 mb-4">
        外站組合比價：兩段各設基準日期＋彈性範圍，比出「哪天去＋哪天回」總價最低。
        每個日期查一次（共 {totalQueries || "—"} 次），未快取時約需 1–3 分鐘，結果逐格填入。
      </p>

      <div className="space-y-5 mb-5">
        <LegRow
          title="段 1｜定位航段"
          hint="例：TPE → BKK（先飛到外站）"
          leg={legA}
          today={today}
          onChange={onLegAChange}
          idPrefix="comboA"
        />
        <LegRow
          title="段 2｜外站出發段"
          hint="例：BKK → TPE（外站票第一段）"
          leg={legB}
          today={today}
          onChange={onLegBChange}
          idPrefix="comboB"
        />
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="w-24">
          <label htmlFor="combo-adults" className="block text-xs font-medium text-gray-500 mb-1">
            人數
          </label>
          <select
            id="combo-adults"
            value={adults}
            onChange={(e) => onAdultsChange(Number(e.target.value))}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-accent focus:ring-1 focus:ring-accent outline-none
                       min-h-[44px]"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n} 人</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[130px]">
          <label htmlFor="combo-cabin" className="block text-xs font-medium text-gray-500 mb-1">
            艙等
          </label>
          <select
            id="combo-cabin"
            value={cabin}
            onChange={(e) => onCabinChange(e.target.value)}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-accent focus:ring-1 focus:ring-accent outline-none
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
        disabled={running || !filled}
        className="w-full bg-cta-gradient text-white font-semibold py-3 px-6 rounded-xl shadow-card
                   hover:shadow-cardHover hover:brightness-[1.04] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-card
                   transition-all min-h-[48px] flex items-center justify-center gap-2"
      >
        {running ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white
                             border-t-transparent rounded-full" />
            組合比價中…
          </>
        ) : (
          "✈ 開始組合比價"
        )}
      </button>
    </div>
  );
}
