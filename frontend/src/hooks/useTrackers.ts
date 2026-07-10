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
      await reload(key);
      return data.tracker;
    } catch (e) {
      setError(e instanceof Error ? e.message : "追蹤建立失敗");
      throw e;
    } finally {
      setSaving(false);
    }
  }, [reload, trackerKey]);

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
  };
}
