// FlightSearch PWA Service Worker
// 手寫，無套件。策略：同源靜態資源 cache-first；其他（含 /api/）一律 network 直通、不快取。

// 更新此版本字串即可讓舊快取失效（部署新版靜態資源時務必更新）。
const CACHE_VERSION = "flight-search-static-v1";

// 允許 cache-first 的同源靜態資源前綴／路徑
const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/"];
const CACHEABLE_EXACT = ["/manifest.json"];

function isCacheableRequest(url) {
  if (url.origin !== self.location.origin) return false;
  if (CACHEABLE_EXACT.includes(url.pathname)) return true;
  return CACHEABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  // 立即進入 activate，不等舊 SW 的分頁全部關閉
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
      // 立即接管所有已開啟的分頁
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 只處理 GET；其餘方法（POST/PUT/DELETE...）一律不攔截，交給瀏覽器原生處理。
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // 同源靜態資源（/_next/static/、/icons/、manifest.json）：cache-first
  if (isCacheableRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const response = await fetch(request);
        // 只快取成功回應，避免把錯誤頁面快取住
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })()
    );
    return;
  }

  // 其他所有請求（含 /api/ 動態查詢）：一律 network 直通，絕不快取、絕不攔截回應。
  // 不呼叫 event.respondWith()，讓瀏覽器用預設網路請求處理，
  // 確保機票搜尋 API 結果永遠是即時資料，不會被 Service Worker 快取住。
  return;
});
