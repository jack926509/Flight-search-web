import { apiUrl, authHeaders } from "./api";

export type TrackerTripType = "one-way" | "round-trip";

export interface PriceTracker {
  id: string;
  trip_type: TrackerTripType;
  origin: string;
  dest: string;
  depart_date: string;
  return_date: string | null;
  adults: number;
  cabin: string;
  target_price_twd: number | null;
  current_price_twd: number | null;
  previous_price_twd: number | null;
  enabled: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export interface TrackerEvent {
  id: string;
  tracker_id: string;
  event_type: "target_price" | "price_drop";
  price_twd: number;
  previous_price_twd: number | null;
  target_price_twd: number | null;
  message: string;
  read: boolean;
  created_at: string;
}

export interface TrackerCreateInput {
  trip_type: TrackerTripType;
  origin: string;
  dest: string;
  date: string;
  return_date?: string | null;
  adults: number;
  cabin: string;
  target_price_twd: number;
}

export interface TrackerListResponse {
  trackers: PriceTracker[];
  events: TrackerEvent[];
  unread_count: number;
}

export interface TrackerCreateResponse extends TrackerListResponse {
  tracker_key: string | null;
  tracker: PriceTracker;
}

function trackerHeaders(trackerKey?: string): Record<string, string> {
  return {
    ...authHeaders(),
    ...(trackerKey ? { "X-Tracker-Key": trackerKey } : {}),
  };
}

async function parseTrackerResponse<T>(resp: Response): Promise<T> {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const message =
      body?.detail ||
      body?.error?.message ||
      `追蹤功能暫時無法使用（HTTP ${resp.status}）`;
    throw new Error(String(message));
  }
  return body as T;
}

export async function createTracker(
  input: TrackerCreateInput,
  trackerKey?: string
): Promise<TrackerCreateResponse> {
  const resp = await fetch(apiUrl("/api/trackers").toString(), {
    method: "POST",
    headers: {
      ...trackerHeaders(trackerKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  return parseTrackerResponse<TrackerCreateResponse>(resp);
}

export async function fetchTrackers(trackerKey: string): Promise<TrackerListResponse> {
  const resp = await fetch(apiUrl("/api/trackers").toString(), {
    headers: trackerHeaders(trackerKey),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  return parseTrackerResponse<TrackerListResponse>(resp);
}

export async function updateTracker(
  trackerKey: string,
  trackerId: string,
  changes: { target_price_twd?: number; enabled?: boolean; mark_all_read?: boolean }
): Promise<TrackerListResponse> {
  const resp = await fetch(apiUrl(`/api/trackers/${trackerId}`).toString(), {
    method: "PATCH",
    headers: {
      ...trackerHeaders(trackerKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(changes),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  return parseTrackerResponse<TrackerListResponse>(resp);
}

export async function deleteTracker(trackerKey: string, trackerId: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/trackers/${trackerId}`).toString(), {
    method: "DELETE",
    headers: trackerHeaders(trackerKey),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  await parseTrackerResponse(resp);
}
