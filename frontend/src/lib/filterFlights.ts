import { formatAirlineLabel } from "./api";
import type { Flight } from "./api";

/** 出發時段分類：凌晨 00-06／上午 06-12／下午 12-18／晚間 18-24（依 depart_time 的小時判斷） */
export type TimeOfDaySlot = "dawn" | "morning" | "afternoon" | "evening";

export const TIME_OF_DAY_LABELS: Record<TimeOfDaySlot, string> = {
  dawn: "凌晨 00-06",
  morning: "上午 06-12",
  afternoon: "下午 12-18",
  evening: "晚間 18-24",
};

export const TIME_OF_DAY_SLOTS: TimeOfDaySlot[] = ["dawn", "morning", "afternoon", "evening"];

/** 篩選狀態：直飛開關、航空公司複選（空陣列＝不限）、出發時段單選（null＝不限） */
export interface FlightFilterState {
  directOnly: boolean;
  airlineCodes: string[];
  timeOfDay: TimeOfDaySlot | null;
}

export const EMPTY_FLIGHT_FILTER: FlightFilterState = {
  directOnly: false,
  airlineCodes: [],
  timeOfDay: null,
};

export function isFlightFilterActive(filters: FlightFilterState): boolean {
  return filters.directOnly || filters.airlineCodes.length > 0 || filters.timeOfDay !== null;
}

/** depart_time（"HH:MM"）→ 出發時段分類；格式不符回傳 null（不參與時段篩選） */
export function getTimeOfDaySlot(departTime: string): TimeOfDaySlot | null {
  const match = /^(\d{1,2}):\d{2}/.exec(departTime);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (hour < 6) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** 航空公司篩選 key：優先用 IATA 代碼，取不到就用中文／原始名稱，需與 filterFlights 用同一套規則 */
function airlineFilterKey(flight: Pick<Flight, "airline" | "flight_no">): string {
  const { code, name } = formatAirlineLabel(flight.airline, flight.flight_no);
  return code || name;
}

/** 從當批結果動態彙整可篩選的航空公司清單（去重、依中文名排序） */
export function getAirlineFilterOptions(flights: Flight[]): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const f of flights) {
    const key = airlineFilterKey(f);
    if (key && !seen.has(key)) {
      seen.set(key, formatAirlineLabel(f.airline, f.flight_no).name);
    }
  }
  return Array.from(seen.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

/**
 * 純函式：單一航班是否通過目前的篩選狀態。
 * 獨立匯出是為了讓需要保留「原始排序索引」的呼叫端（例如來回／多段結果需與
 * 選取索引對齊）能自行 filter 帶索引的陣列，而不必先攤平成新陣列。
 * @param flight 單一航班
 * @param filters 篩選狀態（直飛／航空公司複選＝聯集／時段單選）
 * @returns 是否通過全部篩選條件
 */
export function matchesFlightFilter(flight: Flight, filters: FlightFilterState): boolean {
  if (filters.directOnly && flight.stops !== 0) return false;
  if (filters.airlineCodes.length > 0 && !filters.airlineCodes.includes(airlineFilterKey(flight))) {
    return false;
  }
  if (filters.timeOfDay && getTimeOfDaySlot(flight.depart_time) !== filters.timeOfDay) {
    return false;
  }
  return true;
}

/**
 * 純函式：依篩選狀態過濾航班清單，不修改原陣列，保留原本的相對順序。
 * @param flights 原始航班清單
 * @param filters 篩選狀態（直飛／航空公司複選＝聯集／時段單選）
 * @returns 通過全部篩選條件的航班清單（新陣列）
 */
export function filterFlights(flights: Flight[], filters: FlightFilterState): Flight[] {
  return flights.filter((f) => matchesFlightFilter(f, filters));
}
