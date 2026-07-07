const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
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

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { "X-API-Token": API_TOKEN } : {};
}

export async function searchFlights(
  origin: string,
  dest: string,
  date: string,
  adults: number,
  cabin: string
): Promise<SearchResult> {
  const url = new URL(`${API_URL}/api/search`);
  url.searchParams.set("origin", origin);
  url.searchParams.set("dest", dest);
  url.searchParams.set("date", date);
  url.searchParams.set("adults", String(adults));
  url.searchParams.set("cabin", cabin);

  // 後端最長路徑（fast-flights 3-8s + failover Kiwi ~10s + jitter）約 30s；
  // 逾時不中斷就會永遠停在骨架屏，必須以 AbortController 兜底
  const resp = await fetch(url.toString(), {
    headers: authHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const msg =
      body?.detail?.message ||
      (typeof body?.detail === "string" ? body.detail : null) ||
      body?.error?.message ||
      `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return resp.json();
}

export async function fetchPriceHistory(
  route: string,
  days = 90
): Promise<PricePoint[]> {
  const url = new URL(`${API_URL}/api/history`);
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
