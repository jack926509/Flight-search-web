"use client";

import { useEffect } from "react";

/**
 * 註冊 Service Worker，讓網站可安裝到手機主畫面（PWA）。
 * 靜默失敗：註冊失敗不影響網站正常運作（例如瀏覽器不支援、非 HTTPS 環境）。
 */
export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 靜默失敗：不影響網站主要功能
    });
  }, []);

  return null;
}
