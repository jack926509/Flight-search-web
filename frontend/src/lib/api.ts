const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || "";

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  /** 中文別名（空白分隔，僅主要機場有） */
  zh?: string;
}

export interface Flight {
  airline: string;
  flight_no: string;
  depart_time: string;
  arrive_time: string;
  duration_min: number;
  stops: number;
  price: number;
  currency: string;
  original_currency?: string;
  booking_hint: string;
}

export interface SearchResult {
  flights: Flight[];
  source: string;
  fetched_at: string;
  stale: boolean;
}

export interface PricePoint {
  date: string;
  lowest_price_twd: number;
  source: string;
}

export type SortKey = "price" | "duration" | "depart";

interface AirlineLabel {
  zh: string;
  en: string;
  code?: string;
}

// IATA 兩碼 → 中文／英文名稱對照表（純資料，不含 logo 來源；logo 一律用 pics.avs.io 依 IATA 碼取得）
const AIRLINE_LABELS: Record<string, AirlineLabel> = {
  BR: { zh: "長榮航空", en: "EVA Air", code: "BR" },
  CI: { zh: "中華航空", en: "China Airlines", code: "CI" },
  JX: { zh: "星宇航空", en: "STARLUX Airlines", code: "JX" },
  AE: { zh: "華信航空", en: "Mandarin Airlines", code: "AE" },
  B7: { zh: "立榮航空", en: "UNI Air", code: "B7" },
  IT: { zh: "台灣虎航", en: "Tigerair Taiwan", code: "IT" },
  JL: { zh: "日本航空", en: "Japan Airlines", code: "JL" },
  NH: { zh: "全日空", en: "ANA", code: "NH" },
  MM: { zh: "樂桃航空", en: "Peach Aviation", code: "MM" },
  GK: { zh: "捷星日本", en: "Jetstar Japan", code: "GK" },
  CX: { zh: "國泰航空", en: "Cathay Pacific", code: "CX" },
  UO: { zh: "香港快運", en: "HK Express", code: "UO" },
  HX: { zh: "香港航空", en: "Hong Kong Airlines", code: "HX" },
  SQ: { zh: "新加坡航空", en: "Singapore Airlines", code: "SQ" },
  TR: { zh: "酷航", en: "Scoot", code: "TR" },
  TG: { zh: "泰國國際航空", en: "Thai Airways", code: "TG" },
  VZ: { zh: "泰越捷航空", en: "Thai Vietjet Air", code: "VZ" },
  VN: { zh: "越南航空", en: "Vietnam Airlines", code: "VN" },
  VJ: { zh: "越捷航空", en: "Vietjet Air", code: "VJ" },
  KE: { zh: "大韓航空", en: "Korean Air", code: "KE" },
  OZ: { zh: "韓亞航空", en: "Asiana Airlines", code: "OZ" },
  "7C": { zh: "濟州航空", en: "Jeju Air", code: "7C" },
  LJ: { zh: "真航空", en: "Jin Air", code: "LJ" },
  BX: { zh: "釜山航空", en: "Air Busan", code: "BX" },
  TW: { zh: "德威航空", en: "T'way Air", code: "TW" },
  MH: { zh: "馬來西亞航空", en: "Malaysia Airlines", code: "MH" },
  AK: { zh: "亞洲航空", en: "AirAsia", code: "AK" },
  D7: { zh: "亞洲航空 X", en: "AirAsia X", code: "D7" },
  PR: { zh: "菲律賓航空", en: "Philippine Airlines", code: "PR" },
  "5J": { zh: "宿霧太平洋航空", en: "Cebu Pacific", code: "5J" },
  CZ: { zh: "中國南方航空", en: "China Southern Airlines", code: "CZ" },
  MU: { zh: "中國東方航空", en: "China Eastern Airlines", code: "MU" },
  CA: { zh: "中國國際航空", en: "Air China", code: "CA" },
  HO: { zh: "吉祥航空", en: "Juneyao Airlines", code: "HO" },
  QR: { zh: "卡達航空", en: "Qatar Airways", code: "QR" },
  EK: { zh: "阿聯酋航空", en: "Emirates", code: "EK" },
  TK: { zh: "土耳其航空", en: "Turkish Airlines", code: "TK" },
  SL: { zh: "泰國獅子航空", en: "Thai Lion Air", code: "SL" },
  FD: { zh: "泰國亞洲航空", en: "Thai AirAsia", code: "FD" },
  UA: { zh: "聯合航空", en: "United Airlines", code: "UA" },
  DL: { zh: "達美航空", en: "Delta Air Lines", code: "DL" },
  AA: { zh: "美國航空", en: "American Airlines", code: "AA" },
  ZH: { zh: "深圳航空", en: "Shenzhen Airlines", code: "ZH" },
  EY: { zh: "阿提哈德航空", en: "Etihad Airways", code: "EY" },
  W4: { zh: "威茲馬爾他航空", en: "Wizz Air Malta", code: "W4" },
  FR: { zh: "瑞安航空", en: "Ryanair", code: "FR" },
  OS: { zh: "奧地利航空", en: "Austrian Airlines", code: "OS" },
  "EVA AIR": { zh: "長榮航空", en: "EVA Air", code: "BR" },
  "CHINA AIRLINES": { zh: "中華航空", en: "China Airlines", code: "CI" },
  "HONG KONG AIRLINES": { zh: "香港航空", en: "Hong Kong Airlines", code: "HX" },
  "TURKISH AIRLINES": { zh: "土耳其航空", en: "Turkish Airlines", code: "TK" },
  "AUSTRIAN AIRLINES": { zh: "奧地利航空", en: "Austrian Airlines", code: "OS" },
  SHENZHEN: { zh: "深圳航空", en: "Shenzhen Airlines", code: "ZH" },
};

function airlineCodeFromFlightNo(flightNo: string): string {
  const match = flightNo.trim().toUpperCase().match(/^([A-Z0-9]{2})\d+/);
  return match?.[1] ?? "";
}

// logo 一律走 pics.avs.io，只需 IATA 兩碼；未知代碼會回通用佔位圖（HTTP 200，非 404），非空字串即可顯示
function airlineLogoUrl(code: string): string {
  return code ? `https://pics.avs.io/64/64/${code}.png` : "";
}

export function formatAirlineLabel(airline: string, flightNo = ""): { name: string; detail: string; code: string; logoUrl: string } {
  const cleanedAirline = airline.trim();
  const code = airlineCodeFromFlightNo(flightNo) || (/^[A-Z0-9]{2}$/.test(cleanedAirline) ? cleanedAirline : "");
  const label = AIRLINE_LABELS[code] || AIRLINE_LABELS[cleanedAirline.toUpperCase()];
  const logoUrl = airlineLogoUrl(label?.code || code);

  if (!label) {
    return {
      name: cleanedAirline || "航空公司未提供",
      detail: flightNo,
      code: code || cleanedAirline.slice(0, 2).toUpperCase(),
      logoUrl,
    };
  }

  const detailParts = [label.en];
  if (flightNo) detailParts.push(flightNo);

  return {
    name: label.zh,
    detail: detailParts.join("・"),
    code: label.code || code,
    logoUrl,
  };
}

export function authHeaders(): Record<string, string> {
  return API_TOKEN ? { "X-API-Token": API_TOKEN } : {};
}

export function apiUrl(path: string): URL {
  if (API_URL) return new URL(`${API_URL}${path}`);
  if (typeof window !== "undefined") {
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(window.location.hostname)) {
      return new URL(path, "http://127.0.0.1:8000");
    }
    return new URL(path, window.location.origin);
  }
  return new URL(path, "http://127.0.0.1:8000");
}

/** 依 HTTP 狀態碼與後端錯誤內容，轉成使用者看得懂、知道怎麼辦的中文訊息 */
function friendlyHttpError(status: number, detail: string): string {
  switch (status) {
    case 403:
      return "授權失敗：前端 API Token 與後端不符。請通知管理員重新核對部署設定";
    case 422:
      return `查詢條件有誤，請檢查機場代碼與日期${detail ? `（${detail}）` : ""}`;
    case 429:
      return "查詢太頻繁，請等 1 分鐘後再試";
    case 503:
      return "兩個航班資料來源暫時都無法使用，請稍後重試（系統會自動恢復）";
    default:
      return `伺服器發生錯誤（HTTP ${status}），請稍後重試`;
  }
}

/** fetch 本身拋出的錯誤（連不上／逾時）轉中文 */
function friendlyFetchError(e: unknown): Error {
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new Error("連線逾時：伺服器可能正在忙碌或喚醒中，請稍後重試");
  }
  if (e instanceof TypeError) {
    return new Error("無法連線到伺服器，請確認網路連線後重試");
  }
  return e instanceof Error ? e : new Error("查詢失敗，請稍後重試");
}

export async function searchFlights(
  origin: string,
  dest: string,
  date: string,
  adults: number,
  cabin: string,
  signal?: AbortSignal
): Promise<SearchResult> {
  const url = apiUrl("/api/search");
  url.searchParams.set("origin", origin);
  url.searchParams.set("dest", dest);
  url.searchParams.set("date", date);
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("cabin", cabin);

  // 後端最長路徑（fast-flights 3-8s + failover Kiwi ~10s + jitter）約 30s；
  // 逾時不中斷就會永遠停在骨架屏，必須以 AbortController 兜底。
  // signal 為呼叫端（hook）在「新搜尋開始前」用來 abort 舊搜尋的外部訊號，與 45s 逾時合併。
  const timeoutSignal = AbortSignal.timeout(45_000);
  const combinedSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: authHeaders(),
      cache: "no-store",
      signal: combinedSignal,
    });
  } catch (e) {
    throw friendlyFetchError(e);
  }

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const detail =
      body?.detail?.message ||
      (typeof body?.detail === "string" ? body.detail : "") ||
      body?.error?.message ||
      "";
    throw new Error(friendlyHttpError(resp.status, detail));
  }
  return resp.json();
}

export interface HealthStatus {
  /** 後端可達且回 200 */
  ok: boolean;
  /** DB ping 結果：true/false；後端未設 DB 時為 null */
  db: boolean | null;
}

/** 打 /api/health（免 token）。失敗回 ok:false，不拋錯 */
export async function fetchHealth(): Promise<HealthStatus> {
  try {
    const resp = await fetch(apiUrl("/api/health").toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return { ok: false, db: null };
    const data = await resp.json();
    return { ok: data.status === "ok", db: data.db ?? null };
  } catch {
    return { ok: false, db: null };
  }
}

export async function fetchPriceHistory(
  route: string,
  days = 90
): Promise<PricePoint[]> {
  const url = apiUrl("/api/history");
  url.searchParams.set("route", route);
  url.searchParams.set("days", String(days));

  // 趨勢圖是加值功能：任何錯誤（含逾時）都靜默回空陣列，不打斷主流程
  try {
    const resp = await fetch(url.toString(), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.history ?? [];
  } catch {
    return [];
  }
}

export function sortFlights(flights: Flight[], by: SortKey): Flight[] {
  return [...flights].sort((a, b) => {
    if (by === "price") return a.price - b.price;
    if (by === "duration") return a.duration_min - b.duration_min;
    // depart: compare HH:MM strings lexicographically
    return a.depart_time.localeCompare(b.depart_time);
  });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}
