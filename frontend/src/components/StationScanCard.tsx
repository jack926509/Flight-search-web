"use client";

import { useState } from "react";
import AirportInput from "./AirportInput";
import { BASELINE_STATION, MAX_SCAN_DAYS, MAX_SCAN_STATIONS, STATION_PRESETS } from "@/lib/stationScan";

interface Props {
  dest: string;
  fromDate: string;
  toDate: string;
  stations: string[];
  adults: number;
  cabin: string;
  today: string;
  running: boolean;
  filled: boolean;
  daysOk: boolean;
  stationsOk: boolean;
  dayCount: number;
  queryCount: number;
  onDestChange: (v: string) => void;
  onFromDateChange: (v: string) => void;
  onToDateChange: (v: string) => void;
  onStationsChange: (v: string[]) => void;
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

function isValidIata(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

export default function StationScanCard({
  dest, fromDate, toDate, stations, adults, cabin, today, running, filled,
  daysOk, stationsOk, dayCount, queryCount,
  onDestChange, onFromDateChange, onToDateChange, onStationsChange,
  onAdultsChange, onCabinChange, onSubmit,
}: Props) {
  const [customCode, setCustomCode] = useState("");
  const [customError, setCustomError] = useState("");

  const atStationLimit = stations.length >= MAX_SCAN_STATIONS;

  const togglePreset = (code: string) => {
    if (stations.includes(code)) {
      onStationsChange(stations.filter((s) => s !== code));
      return;
    }
    if (atStationLimit) return;
    onStationsChange([...stations, code]);
  };

  const addCustom = () => {
    const code = customCode.trim().toUpperCase();
    if (!code) return;
    if (!isValidIata(code)) {
      setCustomError("請輸入 3 碼英文機場代碼（例：CDG）");
      return;
    }
    if (code === BASELINE_STATION) {
      setCustomError("TPE 是直飛基準出發地，已自動納入比較，不需加為外站");
      return;
    }
    if (stations.includes(code)) {
      setCustomError("此機場代碼已在候選清單中");
      return;
    }
    if (atStationLimit) {
      setCustomError(`外站候選最多 ${MAX_SCAN_STATIONS} 個，請先移除一個再新增`);
      return;
    }
    onStationsChange([...stations, code]);
    setCustomCode("");
    setCustomError("");
  };

  const removeCustomStation = (code: string) => {
    onStationsChange(stations.filter((s) => s !== code));
  };

  const presetCodes = new Set(STATION_PRESETS.map((s) => s.code));
  const customStations = stations.filter((s) => !presetCodes.has(s));

  return (
    <div className="bg-white rounded-card shadow-card border border-line-soft p-6 w-full max-w-3xl mx-auto">
      <p className="text-xs text-muted mb-4">
        外站範圍掃描：設定目的地與出發日期範圍，掃過每個外站在每一天的單程票價，
        彙總成一張依價格排序的總表，並標出與 TPE 直飛的差額。
      </p>

      {/* 目的地 */}
      <div className="mb-4 max-w-xs">
        <AirportInput id="scan-dest" label="目的地" value={dest} onChange={onDestChange} />
      </div>

      {/* 日期範圍 */}
      <div className="flex flex-wrap gap-3 mb-2">
        <div className="flex-1 min-w-[130px]">
          <label htmlFor="scan-from" className="block text-xs font-medium text-muted mb-1">
            出發日期（起）
          </label>
          <input
            id="scan-from"
            type="date"
            value={fromDate}
            min={today}
            onChange={(e) => onFromDateChange(e.target.value)}
            className="w-full px-3 py-3 border border-line rounded-lg text-sm bg-white
                       focus:border-primary focus:ring-1 focus:ring-primary outline-none
                       min-h-[44px]"
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <label htmlFor="scan-to" className="block text-xs font-medium text-muted mb-1">
            出發日期（迄）
          </label>
          <input
            id="scan-to"
            type="date"
            value={toDate}
            min={fromDate || today}
            onChange={(e) => onToDateChange(e.target.value)}
            aria-invalid={!daysOk}
            className="w-full px-3 py-3 border border-line rounded-lg text-sm bg-white
                       focus:border-primary focus:ring-1 focus:ring-primary outline-none
                       min-h-[44px]"
          />
        </div>
      </div>
      {!daysOk && (
        <p className="text-xs text-danger mb-3">
          日期範圍最多 {MAX_SCAN_DAYS} 天，請縮小起迄區間
        </p>
      )}

      {/* 外站候選 */}
      <div className="mb-2 mt-3">
        <p className="text-xs font-bold text-muted mb-2">
          外站候選
          <span className="ml-2 font-normal text-muted">
            已選 {stations.length} / {MAX_SCAN_STATIONS}
          </span>
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {STATION_PRESETS.map((s) => {
            const checked = stations.includes(s.code);
            const disabled = !checked && atStationLimit;
            return (
              <label
                key={s.code}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-full border text-sm
                            min-h-[40px] transition-colors cursor-pointer
                            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                            ${checked
                              ? "bg-primary text-white border-primary"
                              : "bg-white text-ink border-line hover:bg-field"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => togglePreset(s.code)}
                  className="sr-only"
                />
                {s.code}　{s.label}
              </label>
            );
          })}
        </div>

        {/* 自訂機場代碼 */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[160px]">
            <label htmlFor="scan-custom" className="block text-xs font-medium text-muted mb-1">
              自訂機場代碼
            </label>
            <input
              id="scan-custom"
              type="text"
              value={customCode}
              maxLength={3}
              placeholder="例：CDG"
              disabled={atStationLimit}
              onChange={(e) => {
                setCustomCode(e.target.value.toUpperCase());
                setCustomError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              className="w-full px-3 py-3 border border-line rounded-lg text-sm bg-white uppercase
                         focus:border-primary focus:ring-1 focus:ring-primary outline-none
                         min-h-[44px] disabled:bg-field disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="button"
            onClick={addCustom}
            disabled={atStationLimit || !customCode.trim()}
            className="px-4 py-3 rounded-lg text-sm font-medium border border-line bg-white text-ink
                       hover:bg-field transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ＋ 新增
          </button>
        </div>
        {customError && <p className="text-xs text-danger mt-1">{customError}</p>}

        {customStations.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {customStations.map((code) => (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs
                           bg-accent-soft text-ink border border-line"
              >
                {code}
                <button
                  type="button"
                  onClick={() => removeCustomStation(code)}
                  aria-label={`移除 ${code}`}
                  className="text-muted hover:text-ink"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {!stationsOk && stations.length === 0 && (
          <p className="text-xs text-muted mt-2">請至少勾選或新增一個外站候選</p>
        )}
      </div>

      {/* 人數、艙等 */}
      <div className="flex flex-wrap gap-3 mb-5 mt-3">
        <div className="w-24">
          <label htmlFor="scan-adults" className="block text-xs font-medium text-muted mb-1">
            人數
          </label>
          <select
            id="scan-adults"
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
          <label htmlFor="scan-cabin" className="block text-xs font-medium text-muted mb-1">
            艙等
          </label>
          <select
            id="scan-cabin"
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

      {queryCount > 0 && (
        <p className="text-xs text-muted mb-3">
          查詢次數：{stations.length} 個外站 × {dayCount} 天 ＋ {dayCount} 天（TPE 直飛基準）
          ＝ {queryCount} 次，未快取時約需 5–10 分鐘，結果逐格填入
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={running || !filled}
        className={`w-full font-semibold py-3 px-6 rounded-xl transition-all min-h-[48px]
                   flex items-center justify-center gap-2
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                   ${running
                     ? "bg-primary text-white shadow-card"
                     : !filled
                       ? "bg-field text-muted border border-line cursor-not-allowed"
                       : "bg-primary text-white shadow-card hover:bg-primary-dark hover:shadow-cardHover"}`}
      >
        {running ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white
                             border-t-transparent rounded-full" />
            掃描中…
          </>
        ) : (
          "✈ 開始外站範圍掃描"
        )}
      </button>
    </div>
  );
}
