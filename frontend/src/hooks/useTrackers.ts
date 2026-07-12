"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createTracker,
  deleteTracker,
  fetchTrackers,
  updateTracker,
  type PriceTracker,
  type TrackerCreateInput,
  type TrackerEvent,
} from "@/lib/trackers";

const STORAGE_KEY = "flight-search-tracker-key";

function readStoredKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

function storeKey(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, key);
}

export function useTrackers() {
  const [trackerKey, setTrackerKey] = useState("");
  const [trackers, setTrackers] = useState<PriceTracker[]>([]);
  const [events, setEvents] = useState<TrackerEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyList = useCallback((data: { trackers: PriceTracker[]; events: TrackerEvent[]; unread_count: number }) => {
    setTrackers(data.trackers);
    setEvents(data.events);
    setUnreadCount(data.unread_count);
  }, []);

  const reload = useCallback(async (key = trackerKey) => {
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      applyList(await fetchTrackers(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "追蹤清單讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [applyList, trackerKey]);

  useEffect(() => {
    const key = readStoredKey();
    if (!key) return;
    setTrackerKey(key);
    void reload(key);
  }, [reload]);

  const addTracker = useCallback(async (input: TrackerCreateInput) => {
    setSaving(true);
    setError(null);
    try {
      const data = await createTracker(input, trackerKey || undefined);
      const key = data.tracker_key || trackerKey;
      if (key && key !== trackerKey) {
        storeKey(key);
        setTrackerKey(key);
      }
      // 建立 API 已回傳最新 tracker；先直接呈現，避免行動網路上第二次讀取失敗
      // 反而把已成功的建立誤判成失敗。後續開啟抽屜時仍會走既有 reload。
      applyList({
        trackers: data.trackers?.length ? data.trackers : [data.tracker],
        events: data.events ?? [],
        unread_count: data.unread_count ?? 0,
      });
      return data.tracker;
    } catch (e) {
      setError(e instanceof Error ? e.message : "追蹤建立失敗");
      throw e;
    } finally {
      setSaving(false);
    }
  }, [applyList, trackerKey]);

  const setTrackerEnabled = useCallback(async (trackerId: string, enabled: boolean) => {
    if (!trackerKey) return;
    applyList(await updateTracker(trackerKey, trackerId, { enabled }));
  }, [applyList, trackerKey]);

  const markTrackerRead = useCallback(async (trackerId: string) => {
    if (!trackerKey) return;
    applyList(await updateTracker(trackerKey, trackerId, { mark_all_read: true }));
  }, [applyList, trackerKey]);

  const removeTracker = useCallback(async (trackerId: string) => {
    if (!trackerKey) return;
    await deleteTracker(trackerKey, trackerId);
    await reload(trackerKey);
  }, [reload, trackerKey]);

  const restore = useCallback(async (rawKey: string) => {
    const key = rawKey.trim();
    if (!key) throw new Error("請貼上追蹤恢復碼");
    const data = await fetchTrackers(key);
    storeKey(key);
    setTrackerKey(key);
    applyList(data);
  }, [applyList]);

  return {
    trackers,
    events,
    unreadCount,
    loading,
    saving,
    error,
    reload,
    addTracker,
    setTrackerEnabled,
    markTrackerRead,
    removeTracker,
    trackerKey,
    restore,
  };
}
