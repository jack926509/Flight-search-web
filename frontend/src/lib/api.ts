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
  domain?: string;
}

const AIRLINE_LABELS: Record<string, AirlineLabel> = {
  BR: { zh: "長榮航空", en: "EVA Air", code: "BR", domain: "evaair.com" },
  CI: { zh: "中華航空", en: "China Airlines", code: "CI", domain: "china-airlines.com" },
  HX: { zh: "香港航空", en: "Hong Kong Airlines", code: "HX", domain: "hongkongairlines.com" },
  TK: { zh: "土耳其航空", en: "Turkish Airlines", code: "TK", domain: "turkishairlines.com" },
  ZH: { zh: "深圳航空", en: "Shenzhen Airlines", code: "ZH", domain: "global.shenzhenair.com" },
  EY: { zh: "阿提哈德航空", en: "Etihad Airways", code: "EY", domain: "etihad.com" },
  MU: { zh: "中國東方航空", en: "China Eastern Airlines", code: "MU", domain: "ceair.com" },
  W4: { zh: "威茲馬爾他航空", en: "Wizz Air Malta", code: "W4", domain: "wizzair.com" },
  FR: { zh: "瑞安航空", en: "Ryanair", code: "FR", domain: "ryanair.com" },
  CA: { zh: "中國國際航空", en: "Air China", code: "CA", domain: "airchina.com.cn" },
  TW: { zh: "德威航空", en: "T'way Air", code: "TW", domain: "twayair.com" },
  OS: { zh: "奧地利航空", en: "Austrian Airlines", code: "OS", domain: "austrian.com" },
  "EVA AIR": { zh: "長榮航空", en: "EVA Air", code: "BR", domain: "evaair.com" },
  "CHINA AIRLINES": { zh: "中華航空", en: "China Airlines", code: "CI", domain: "china-airlines.com" },
  "HONG KONG AIRLINES": { zh: "香港航空", en: "Hong Kong Airlines", code: "HX", domain: "hongkongairlines.com" },
  "TURKISH AIRLINES": { zh: "土耳其航空", en: "Turkish Airlines", code: "TK", domain: "turkishairlines.com" },
  "AUSTRIAN AIRLINES": { zh: "奧地利航空", en: "Austrian Airlines", code: "OS", domain: "austrian.com" },
  SHENZHEN: { zh: "深圳航空", en: "Shenzhen Airlines", code: "ZH", domain: "global.shenzhenair.com" },
};

function airlineCodeFromFlightNo(flightNo: string): string {
  const match = flightNo.trim().toUpperCase().match(/^([A-Z0-9]{2})\d+/);
  return match?.[1] ?? "";
}

function airlineLogoUrl(domain?: string): string {
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : "";
}

export function formatAirlineLabel(airline: string, flightNo = ""): { name: string; detail: string; code: string; logoUrl: string } {
  const cleanedAirline = airline.trim();
  const code = airlineCodeFromFlightNo(flightNo) || (/^[A-Z0-9]{2}$/.test(cleanedAirline) ? cleanedAirline : "");
  const label = AIRLINE_LABELS[code] || AIRLINE_LABELS[cleanedAirline.toUpperCase()];

  if (!label) {
    return {
      name: cleanedAirline || "航空公司未提供",
      detail: flightNo,
      code: code || cleanedAirline.slice(0, 2).toUpperCase(),
      logoUrl: "",
    };
  }

  const detailParts = [label.en];
  if (flightNo) detailParts.push(flightNo);

  return {
    name: label.zh,
    detail: detailParts.join("・"),
    code: label.code || code,
    logoUrl: airlineLogoUrl(label.domain),
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
  cabin: string
): Promise<SearchResult> {
  const url = apiUrl("/api/search");
  url.searchParams.set("origin", origin);
  url.searchParams.set("dest", dest);
  url.searchParams.set("date", date);
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("cabin", cabin);

  // 後端最長路徑（fast-flights 3-8s + failover Kiwi ~10s + jitter）約 30s；
  // 逾時不中斷就會永遠停在骨架屏，必須以 AbortController 兜底
  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
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
