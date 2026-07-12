import type { Flight } from "@/lib/api";

/**
 * 外站範圍掃描：比較「從多個外站出發到同一目的地、多個日期」的單程票價，
 * 找出底價出發點與日期。另加 TPE→目的地 同日期範圍作為直飛基準（VS 直飛差額）。
 * 第一期只做外站直票掃描，拆票（外站→TPE 銜接段）留擴充點、不實作內容。
 */

export const BASELINE_STATION = "TPE";
/** 出發日期範圍上限（UI 硬擋） */
export const MAX_SCAN_DAYS = 7;
/** 外站候選合計上限（內建 + 自訂，UI 硬擋） */
export const MAX_SCAN_STATIONS = 6;

export interface StationPreset {
  code: string;
  label: string;
}

export const STATION_PRESETS: StationPreset[] = [
  { code: "MNL", label: "馬尼拉" },
  { code: "CEB", label: "宿霧" },
  { code: "OKA", label: "沖繩" },
  { code: "HKG", label: "香港" },
  { code: "BKK", label: "曼谷" },
  { code: "SIN", label: "新加坡" },
];

export type ScanCellStatus = "loading" | "done" | "empty" | "error";

/** 單一（外站, 日期）查詢格：存整批 flights，方便同時導出「最便宜」與「最便宜直飛」 */
export interface ScanCell {
  status: ScanCellStatus;
  flights: Flight[];
}

export interface ScanTask {
  /** 出發站；BASELINE_STATION（TPE）為直飛基準查詢 */
  station: string;
  date: string;
}

export type ScanGrade = "best" | "normal" | "high";

export interface ScanVsDirect {
  /** 正值＝比直飛貴，負值＝比直飛省 */
  diff: number;
  label: string;
  /** 當日查無直飛，以最便宜轉機價替代作為基準 */
  approximate: boolean;
}

export interface ScanRow {
  station: string;
  date: string;
  flight: Flight;
  /** 是否為 TPE 直飛基準列（VS 直飛欄位對自身顯示「——」） */
  isBaseline: boolean;
  /** 分級：掃描中（未 done）一律 null，UI 顯示「計算中」灰色徽章 */
  grade: ScanGrade | null;
  vsDirect: ScanVsDirect | null;
  /**
   * 拆票（外站→TPE 銜接段）擴充點，第一期不實作內容。
   * 保留欄位供未來 computeRows 第三參數傳入時填入。
   */
  breakdown?: { mainLeg: Flight; feederLeg?: Flight };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** from～to（含頭尾）逐日展開；from 晚於 to 或任一為空回傳空陣列 */
export function datesInRange(from: string, to: string): string[] {
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const cursor = new Date(start);
  // 安全上限：避免日期字串異常時無窮迴圈（正常操作下遠低於此上限）
  let guard = 0;
  while (cursor <= end && guard < 366) {
    out.push(isoLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return out;
}

export function cellKey(station: string, date: string): string {
  return `${station}::${date}`;
}

/** 任務清單：TPE 直飛基準（每天一筆）＋每個外站 × 每天一筆 */
export function buildTasks(stations: string[], dates: string[]): ScanTask[] {
  const tasks: ScanTask[] = dates.map((date) => ({ station: BASELINE_STATION, date }));
  for (const station of stations) {
    for (const date of dates) tasks.push({ station, date });
  }
  return tasks;
}

function cheapestOf(flights: Flight[]): Flight | null {
  // price ≤ 0 視為無效報價：0 元航班會把全表分級基準拉到 0，所有列都誤標「底價」
  const priced = flights.filter((f) => f.price > 0);
  if (priced.length === 0) return null;
  return [...priced].sort((a, b) => a.price - b.price)[0];
}

function cheapestDirectOf(flights: Flight[]): Flight | null {
  return cheapestOf(flights.filter((f) => f.stops === 0));
}

/** 對全體最低價 ≤5%＝底價、≤15%＝一般、其餘＝偏高 */
export function gradePrice(price: number, minPrice: number): ScanGrade {
  if (minPrice <= 0) return "best";
  const pct = (price - minPrice) / minPrice;
  if (pct <= 0.05) return "best";
  if (pct <= 0.15) return "normal";
  return "high";
}

/** 與直飛基準比較；基準價一律為正數（呼叫端已篩過 null） */
export function vsDirect(price: number, baselinePrice: number, approximate: boolean): ScanVsDirect {
  const diff = price - baselinePrice;
  const label =
    diff === 0
      ? "與直飛同價"
      : diff > 0
        ? `貴 NT$ ${diff.toLocaleString()}`
        : `省 NT$ ${Math.abs(diff).toLocaleString()}`;
  return { diff, label, approximate };
}

/**
 * 攤平＋排序：從 results（含 TPE 基準格）導出依價格排序的列表。
 * done=false 時 grade 一律 null（掃描中不定案，避免分級基準持續下修造成徽章跳動）。
 * feederResults 為拆票擴充點的預留參數，第一期不使用。
 */
export function computeRows(
  results: Record<string, ScanCell>,
  stations: string[],
  dates: string[],
  done: boolean,
  _feederResults?: Record<string, ScanCell>
): ScanRow[] {
  void _feederResults;
  const rows: ScanRow[] = [];
  const baselineByDate: Record<string, { price: number; approximate: boolean } | null> = {};

  for (const date of dates) {
    const cell = results[cellKey(BASELINE_STATION, date)];
    if (!cell || cell.status !== "done") {
      baselineByDate[date] = null;
      continue;
    }
    const direct = cheapestDirectOf(cell.flights);
    const rowFlight = direct ?? cheapestOf(cell.flights);
    if (direct) {
      baselineByDate[date] = { price: direct.price, approximate: false };
    } else {
      const fallback = cheapestOf(cell.flights);
      baselineByDate[date] = fallback ? { price: fallback.price, approximate: true } : null;
    }
    if (rowFlight) {
      rows.push({
        station: BASELINE_STATION,
        date,
        flight: rowFlight,
        isBaseline: true,
        grade: null,
        vsDirect: null,
      });
    }
  }

  for (const station of stations) {
    for (const date of dates) {
      const cell = results[cellKey(station, date)];
      if (!cell || cell.status !== "done") continue;
      const flight = cheapestOf(cell.flights);
      if (!flight) continue;
      const baseline = baselineByDate[date];
      const vs = baseline ? vsDirect(flight.price, baseline.price, baseline.approximate) : null;
      rows.push({ station, date, flight, isBaseline: false, grade: null, vsDirect: vs });
    }
  }

  if (done && rows.length > 0) {
    const min = Math.min(...rows.map((r) => r.flight.price));
    for (const r of rows) r.grade = gradePrice(r.flight.price, min);
  }

  rows.sort((a, b) => a.flight.price - b.flight.price);
  return rows;
}

export interface ScanParams {
  dest: string;
  from: string;
  to: string;
  stations: string[];
  adults: number;
  cabin: string;
}

export function encodeScanParams(p: ScanParams): URLSearchParams {
  return new URLSearchParams({
    mode: "scan",
    dest: p.dest,
    from: p.from,
    to: p.to,
    stations: p.stations.join(","),
    adults: String(p.adults),
    cabin: p.cabin,
  });
}

interface ParamsLike {
  get(key: string): string | null;
}

export function decodeScanParams(searchParams: ParamsLike): ScanParams & { valid: boolean } {
  const dest = (searchParams.get("dest") || "").trim().toUpperCase();
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  // 去重＋排除 TPE：重複代碼會造成重複 cellKey（進度灌水、React 重複 key），
  // TPE 已是直飛基準，再列為外站會重複出現兩次
  const stations = Array.from(
    new Set(
      (searchParams.get("stations") || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && s !== BASELINE_STATION)
    )
  ).slice(0, MAX_SCAN_STATIONS);
  const adults = Math.max(1, Math.min(9, Number(searchParams.get("adults")) || 1));
  const cabin = searchParams.get("cabin") || "economy";
  const valid = !!dest && !!from && !!to && stations.length > 0;
  return { dest, from, to, stations, adults, cabin, valid };
}
