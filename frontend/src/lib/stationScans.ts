import { apiUrl, authHeaders, timeoutSignal, type Flight } from "./api";

export interface StationScanInput {
  dest: string;
  from_date: string;
  to_date: string;
  stations: string[];
  adults: number;
  cabin: string;
}

export interface StationScanCellResponse {
  station: string;
  departure_date: string;
  status: "pending" | "running" | "done" | "empty" | "error";
  flights: Flight[];
}

export interface StationScanResponse {
  job: { id: string; status: "pending" | "running" | "completed" | "cancelled" | "failed"; dest: string; stations: string[]; from_date: string; to_date: string };
  total: number;
  done?: number;
  cells: StationScanCellResponse[];
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.detail || body?.error?.message || "外站掃描暫時無法建立");
  return body as T;
}

export async function createStationScan(input: StationScanInput): Promise<StationScanResponse> {
  const response = await fetch(apiUrl("/api/station-scans").toString(), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: timeoutSignal(15_000),
  });
  return parse<StationScanResponse>(response);
}

export async function getStationScan(jobId: string): Promise<StationScanResponse> {
  const response = await fetch(apiUrl(`/api/station-scans/${jobId}`).toString(), {
    headers: authHeaders(), cache: "no-store", signal: timeoutSignal(12_000),
  });
  return parse<StationScanResponse>(response);
}

export async function cancelStationScan(jobId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/station-scans/${jobId}`).toString(), {
    method: "DELETE", headers: authHeaders(), cache: "no-store", signal: timeoutSignal(12_000),
  });
  await parse(response);
}
