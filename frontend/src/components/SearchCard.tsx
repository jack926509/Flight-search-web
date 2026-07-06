"use client";

import AirportInput from "./AirportInput";

interface Props {
  origin: string;
  dest: string;
  date: string;
  adults: number;
  cabin: string;
  today: string;
  loading: boolean;
  onOriginChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onDateChange: (v: string) => void;
  onAdultsChange: (v: number) => void;
  onCabinChange: (v: string) => void;
  onSwap: () => void;
  onSubmit: () => void;
}

const CABINS = [
  { value: "economy", label: "經濟艙" },
  { value: "premium-economy", label: "豪華經濟" },
  { value: "business", label: "商務艙" },
  { value: "first", label: "頭等艙" },
];

export default function SearchCard({
  origin, dest, date, adults, cabin, today, loading,
  onOriginChange, onDestChange, onDateChange, onAdultsChange, onCabinChange,
  onSwap, onSubmit,
}: Props) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSubmit();
  };

  return (
    <div
      className="bg-white rounded-2xl shadow-md p-6 w-full max-w-3xl mx-auto"
      onKeyDown={handleKeyDown}
    >
      {/* Row 1: airports + swap */}
      <div className="flex items-end gap-2 mb-4">
        <AirportInput
          id="origin"
          label="出發地"
          value={origin}
          onChange={onOriginChange}
        />
        <button
          type="button"
          onClick={onSwap}
          aria-label="對調出發地與目的地"
          className="mb-1 p-2 rounded-full border border-gray-300 hover:bg-gray-100
                     transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          ⇄
        </button>
        <AirportInput
          id="dest"
          label="目的地"
          value={dest}
          onChange={onDestChange}
        />
      </div>

      {/* Row 2: date, adults, cabin */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex-1 min-w-[130px]">
          <label htmlFor="date" className="block text-xs font-medium text-gray-500 mb-1">
            出發日期
          </label>
          <input
            id="date"
            type="date"
            value={date}
            min={today}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-[#0B5FFF] focus:ring-1 focus:ring-[#0B5FFF] outline-none
                       min-h-[44px]"
          />
        </div>

        <div className="w-24">
          <label htmlFor="adults" className="block text-xs font-medium text-gray-500 mb-1">
            人數
          </label>
          <select
            id="adults"
            value={adults}
            onChange={(e) => onAdultsChange(Number(e.target.value))}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-[#0B5FFF] focus:ring-1 focus:ring-[#0B5FFF] outline-none
                       min-h-[44px]"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n} 人</option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[130px]">
          <label htmlFor="cabin" className="block text-xs font-medium text-gray-500 mb-1">
            艙等
          </label>
          <select
            id="cabin"
            value={cabin}
            onChange={(e) => onCabinChange(e.target.value)}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white
                       focus:border-[#0B5FFF] focus:ring-1 focus:ring-[#0B5FFF] outline-none
                       min-h-[44px]"
          >
            {CABINS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading || !origin || !dest || !date}
        className="w-full bg-[#0B5FFF] text-white font-semibold py-3 px-6 rounded-xl
                   hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors min-h-[48px] flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white
                             border-t-transparent rounded-full" />
            搜尋中…
          </>
        ) : (
          "✈ 搜尋航班"
        )}
      </button>
    </div>
  );
}
