"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/api";
import type { PriceTracker, TrackerEvent } from "@/lib/trackers";

interface Props {
  trackers: PriceTracker[];
  events: TrackerEvent[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onToggle: (trackerId: string, enabled: boolean) => void;
  onMarkRead: (trackerId: string) => void;
  onDelete: (trackerId: string) => void;
  trackerKey: string;
  onRestore: (key: string) => Promise<void>;
}

function tripLabel(tracker: PriceTracker): string {
  if (tracker.trip_type === "round-trip") {
    return `${tracker.origin} ⇄ ${tracker.dest}`;
  }
  return `${tracker.origin} → ${tracker.dest}`;
}

function dateLabel(tracker: PriceTracker): string {
  if (tracker.trip_type === "round-trip") {
    return `${tracker.depart_date} / ${tracker.return_date}`;
  }
  return tracker.depart_date;
}

export default function TrackerDrawer({
  trackers, events, unreadCount, loading, error,
  onReload, onToggle, onMarkRead, onDelete, trackerKey, onRestore,
}: Props) {
  const [open, setOpen] = useState(false);
  const [restoreKey, setRestoreKey] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const eventsByTracker = new Map<string, TrackerEvent[]>();
  for (const event of events) {
    const list = eventsByTracker.get(event.tracker_id) || [];
    list.push(event);
    eventsByTracker.set(event.tracker_id, list);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onReload();
        }}
        className="relative px-3 py-2 rounded-lg border border-line text-sm font-semibold text-ink
                   hover:bg-field min-h-[40px]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label="開啟追蹤清單"
      >
        追蹤
        {unreadCount > 0 && (
          <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-[#B45309] px-1 text-xs text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="追蹤清單">
          <button
            type="button"
            aria-label="關閉追蹤清單背景"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-float flex flex-col">
            <header className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-ink">機票追蹤</h2>
                <p className="text-xs text-muted">站內通知＋降價自動推播 LINE</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-10 h-10 rounded-full border border-line hover:bg-field"
                aria-label="關閉追蹤清單"
              >
                ×
              </button>
            </header>

            <div className="p-4 overflow-y-auto space-y-3">
              {loading && <p className="text-sm text-muted">讀取追蹤清單中…</p>}
              {error && <p className="text-sm text-danger">{error}</p>}
              {!loading && trackers.length === 0 && (
                <div className="py-12 text-center space-y-2">
                  <p aria-hidden className="text-3xl">🔔</p>
                  <p className="text-ink font-medium">還沒有追蹤中的機票</p>
                  <p className="text-sm text-muted">
                    搜尋航班後，按結果上方的「追蹤」，降價時會自動通知
                  </p>
                </div>
              )}

              <details className="rounded-xl border border-line bg-field p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-ink">備份或恢復追蹤清單</summary>
                <div className="mt-3 space-y-2 text-xs text-muted text-pretty">
                  <p>此恢復碼可在另一台裝置取回你的追蹤清單。請自行妥善保存，任何持有恢復碼的人都能查看該清單。</p>
                  {trackerKey && (
                    <label className="block">
                      目前恢復碼
                      <input readOnly value={trackerKey} aria-label="目前追蹤恢復碼" className="mt-1 min-h-[40px] w-full rounded border border-line bg-white px-2 font-mono text-xs text-ink" />
                    </label>
                  )}
                  <label className="block">
                    匯入恢復碼
                    <input value={restoreKey} onChange={(event) => { setRestoreKey(event.target.value); setRestoreError(null); }} aria-label="匯入追蹤恢復碼" className="mt-1 min-h-[40px] w-full rounded border border-line bg-white px-2 font-mono text-xs text-ink" />
                  </label>
                  <button
                    type="button"
                    onClick={() => void onRestore(restoreKey).then(() => { setRestoreKey(""); setRestoreError(null); }).catch((error) => setRestoreError(error instanceof Error ? error.message : "恢復失敗"))}
                    className="min-h-[40px] rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-ink hover:bg-field"
                  >
                    匯入追蹤清單
                  </button>
                  {restoreError && <p className="text-danger">{restoreError}</p>}
                </div>
              </details>

              {trackers.map((tracker) => {
                const latestEvents = eventsByTracker.get(tracker.id) || [];
                const unread = latestEvents.some((event) => !event.read);
                return (
                  <section
                    key={tracker.id}
                    className={`rounded-xl border p-4 space-y-3 ${unread ? "border-[#B45309] bg-amber-50" : "border-line bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-ink">{tripLabel(tracker)}</p>
                        <p className="text-xs text-muted">{dateLabel(tracker)}・{tracker.adults} 人・{tracker.cabin}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${tracker.enabled ? "bg-green-soft text-green" : "bg-field text-muted"}`}>
                        {tracker.enabled ? "追蹤中" : "已停用"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-field p-2">
                        <p className="text-xs text-muted">目前最低</p>
                        <p className="font-bold text-price">
                          {tracker.current_price_twd ? `NT$ ${tracker.current_price_twd.toLocaleString()}` : "待檢查"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-field p-2">
                        <p className="text-xs text-muted">目標價</p>
                        <p className="font-bold text-ink">
                          {tracker.target_price_twd ? `NT$ ${tracker.target_price_twd.toLocaleString()}` : "未設定"}
                        </p>
                      </div>
                    </div>

                    {latestEvents.slice(0, 2).map((event) => (
                      <p key={event.id} className="text-xs text-[#B45309]">
                        {event.message}・{formatRelativeTime(event.created_at)}
                      </p>
                    ))}

                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => onToggle(tracker.id, !tracker.enabled)}
                        className="px-3 py-2 text-xs rounded-lg border border-line hover:bg-field min-h-[36px]"
                      >
                        {tracker.enabled ? "停用" : "啟用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkRead(tracker.id)}
                        className="px-3 py-2 text-xs rounded-lg border border-line hover:bg-field min-h-[36px]"
                      >
                        標記已讀
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(tracker.id)}
                        className="px-3 py-2 text-xs rounded-lg border border-danger text-danger hover:bg-danger-bg min-h-[36px]"
                      >
                        刪除
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
