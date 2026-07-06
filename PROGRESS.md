# 專案進度追蹤 Checklist

> 依據《機票快速搜尋系統建置計畫書 v2.4》各 Phase 查核點整理。
> 狀態圖例：✅ 已完成　🔶 進行中／待人工驗收　⬜ 未開始　🧑 需人工操作
> 最後更新：2026-07-06

---

## 進度總覽

| Phase | 內容 | 程式碼 | 測試 | 人工驗收 | 狀態 |
|---|---|---|---|---|---|
| 0 | 環境準備 | — | — | 🧑 | 🔶 部分待辦 |
| 1 | 雙 provider＋切換鏈 | ✅ | ✅ 20 | 🔶 | 🔶 待人工驗收 |
| 2 | 快取＋歷史＋stale | ✅ | ✅ 6 | 🔶 | 🔶 待人工驗收 |
| 3 | 熔斷＋配額＋防護＋排程 | ✅ | ✅ 16 | 🔶 | 🔶 待人工驗收 |
| 4 | 前端 UI | ✅ | — | 🔶 | 🔶 待人工驗收 |
| 5 | 部署＋E2E＋驗收 | ✅ E2E | ⬜ | ⬜ | ⬜ 未開始 |

**目前測試總數：42 passing**（Phase 1: 20 + Phase 2: 6 + Phase 3: 16）

**2026-07-06 全系統程式碼審查**：修正節流自動恢復、`/api/history` rate limit、
token 時序攻擊防護、UTC 日期偏移、Playwright 依賴缺失等 12 項問題。
環境變數規劃已對齊附錄 B——範本見 `backend/.env.example`、`frontend/.env.example`，
Zeabur / Cloudflare Pages 部署對照表與順序見根目錄 `DEPLOYMENT.md`。

---

## Phase 0：環境準備 🧑

- [x] GitHub repo（monorepo：`/backend`、`/frontend`）— repo 已存在
- [ ] 🧑 Supabase 建專案，取得 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`
- [ ] 🧑 Amadeus 註冊 → 建 app → 申請移轉 production（等待審核期間先用 test key）
- [ ] 🧑 下載 OurAirports `airports.csv` 放進 `/data`（Phase 4 才會用到）
- [ ] 🧑 產生 API Token（`openssl rand -hex 24`）存密碼管理器
- [ ] 🧑 Amadeus test key 以 curl 換得 OAuth token；production 申請已送出
- [ ] `git tag phase-0-done`

---

## Phase 1：雙 provider 最小骨架＋切換鏈 ✅（程式碼）

**已交付程式碼**
- [x] `providers/base.py`：`Flight` / `SearchResult` / `FlightProvider` 抽象
- [x] `providers/fast_flights_provider.py`：`asyncio.to_thread` 包裝、Semaphore(1)＋3–6s jitter
- [x] `providers/amadeus_provider.py`：OAuth token 記憶體快取、`AMADEUS_ENV` 切換
- [x] `services/search_chain.py`：順序 failover、空結果視為成功（G2）
- [x] `main.py`：`/api/search`（參數驗證）、`/api/health`、全域錯誤處理
- [x] `Dockerfile` / `requirements.txt` / `.env.example`

**查核點**
- [x] `pytest` 全綠（19）
- [x] Code review：`main.py` 不 import `fast_flights` / `httpx`（全封裝）
- [x] 無硬編碼金鑰
- [ ] 🧑 `/api/search` 回傳 `source: fast_flights`、每筆 `currency` 為 TWD（目視原始 JSON）
- [ ] 🧑 切換實測：暫時弄壞 fast-flights → 回 `source: amadeus` → 還原
- [ ] 🧑 非法參數 422；`docker build` 且容器內可查詢
- [ ] 🧑 阻塞實測：`/api/search` 查詢中同時打 `/api/health` 必須 <1 秒回應
- [ ] `git tag phase-1-done`

---

## Phase 2：Supabase 快取層＋價格歷史＋Stale 兜底 ✅（程式碼）

**已交付程式碼**
- [x] `db/schema.sql`：四張表＋種子＋index
- [x] `db/client.py`：`AsyncClient` 懶初始化
- [x] `db/repository.py`：cache CRUD、history upsert、`ping_db`
- [x] `services/cached_search.py`：三路 cache-aside
- [x] `main.py`：lifespan 初始化、`/api/history`、health 加 `db` ping
- [x] `providers/base.py`：`SearchResult.stale` 欄位

**查核點**
- [x] `pytest` 全綠（6 新增，共 25）
- [x] G1 history 基準鐵則（測試覆蓋）
- [x] G2 空結果不觸發 failover（測試覆蓋）
- [ ] 🧑 執行 `db/schema.sql`，Table Editor 見四張表、`tracked_routes` 三筆種子
- [ ] 🧑 設定 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`
- [ ] 🧑 同查詢連打兩次：第一次 `fast_flights`（3–8s）、第二次 `cache`（<1s）
- [ ] 🧑 改某筆 `expires_at` 為過去＋弄壞兩 provider → 回 `stale: true`
- [ ] 🧑 `/api/history` 有資料
- [ ] 🧑 health 保活實測：填錯 `SUPABASE_URL` → `db` 欄位轉 false
- [ ] `git tag phase-2-done`

---

## Phase 3：穩定性強化包 ✅（程式碼）

**已交付程式碼**
- [x] `services/circuit_breaker.py`：CBState 三態機（附錄 E 規格）、asyncio.Lock（E4）、DB 持久化（E6）
- [x] `db/schema_v2.sql`：Phase 3 遷移（provider_status 種子）
- [x] Amadeus 配額保護：G3 先計數後呼叫、月輪替、90% 停用（`QuotaExceeded`）
- [x] API 防護：`X-API-Token` 中介軟體（/health 豁免）、slowapi 20/min
- [x] 每日排程：APScheduler 09:00 Asia/Taipei、misfire_grace_time=3600、冪等
- [x] 節流模式：封鎖訊號偵測 → `_throttled`、TTL 拉長至 180min
- [x] tenacity `AsyncRetrying` ×2（fast_flights + Amadeus）
- [x] pytest：8 熔斷情境 + 8 Phase 3 情境（共 41 tests passing）

**查核點**
- [ ] 🧑 熔斷實測、重啟狀態一致、配額停用、token/rate limit、節流、排程
- [ ] 🧑 附錄 F 閘門判定（curl）：通過 → 切 production 實測
- [ ] `git tag phase-3-done`

---

## Phase 4：前端 UI ✅（程式碼）

**已交付程式碼**
- [x] Next.js 15（App Router、`output:'export'`）+ TS + Tailwind + Recharts — `next build` 靜態輸出成功
- [x] `scripts/build-airports.mjs`：讀 `/data/airports.csv` → `public/airports.json`（含 40 主要機場存根）
- [x] 機場 autocomplete（Fuse.js 中英文/代碼模糊搜尋，客端執行）
- [x] 單頁式：搜尋卡片＋結果區＋三排序 tab＋價格趨勢摺疊區（Recharts dynamic import）
- [x] 四狀態：loading 骨架屏文案輪播 / 空結果＋前後一天快捷鈕 / 錯誤＋重試 / stale 黃色警示
- [x] 搜尋條件同步 URL query string；URL 直開自動觸發搜尋
- [x] 深層連結改「在 Google Flights 查看」（G5）
- [x] `original_currency` 換算提示（tooltip）
- [x] 首屏 JS 118 KB（目標 < 150 KB gzip）

**查核點**
- [ ] 🧑 下載 `airports.csv` → `npm run build:airports` 確認 JSON < 300KB；「東京」「NRT」「Tokyo」找得到成田
- [ ] 🧑 完整搜尋流程目視；URL 直開自動搜尋
- [ ] 🧑 四狀態逐一目視（後端配合模擬）
- [ ] 🧑 Lighthouse mobile Perf ≥ 90、A11y ≥ 95
- [ ] `git tag phase-4-done`

---

## Phase 5：部署＋E2E＋監控＋最終驗收 ⬜

**已交付程式碼**
- [x] Playwright E2E 四條測試（含 G4 流量自律：用快取日期避免觸發真實 provider）
  - (a) TPE→NRT 出現 ≥1 張卡片
  - (b) 切換排序後首卡符合排序邏輯
  - (c) 無航班路線走到空結果畫面＋前後一天快捷鈕
  - 375px 無橫向捲軸

**待人工操作**
- [ ] 🧑 Zeabur 部署 `/backend`（環境變數見附錄 B）
- [ ] 🧑 Cloudflare Pages 部署 `/frontend`
- [ ] 🧑 後端 CORS 只允許 Pages 網域
- [ ] 🧑 UptimeRobot 打 `/api/health`（5 分鐘）

**最終驗收（=第 0 章成功標準）**
- [ ] 🧑 快取 <1s／未命中 <8s（Network 面板）
- [ ] 🧑 線上熔斷演練：暫壞 fast-flights → 自動切 Amadeus → 還原
- [ ] 🧑 無 token 掃描被 403；Playwright 全綠
- [ ] 🧑 隔日確認排程自動寫入三條航線歷史
- [ ] 🧑 **【結案封鎖】附錄 F 閘門已通過、`AMADEUS_ENV=production` 且熔斷演練用真實報價**
- [ ] 🧑 UptimeRobot 連續 7 天 ≥ 99% → `git tag v1.0.0` **結案**

---

## 待人工操作彙總（阻擋後續 Phase 的關鍵項）

| 優先 | 項目 | 阻擋 |
|---|---|---|
| 🔴 高 | 提供 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Phase 2 驗收、Phase 3 排程 |
| 🔴 高 | 執行 `db/schema.sql` | Phase 2 驗收 |
| 🟡 中 | Amadeus test key + production 申請 | Phase 3 閘門、切換實測 |
| 🟡 中 | 產生 API Token | Phase 3 API 防護 |
| 🟢 低 | 下載 `airports.csv` | Phase 4 |
