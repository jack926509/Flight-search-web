# 專案進度追蹤 Checklist

> 依據《機票快速搜尋系統建置計畫書 v2.4》各 Phase 查核點整理。
> 狀態圖例：✅ 已完成　🔶 進行中／待人工驗收　⬜ 未開始　🧑 需人工操作
> 最後更新：2026-07-07

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

**目前測試總數：43 passing**（Phase 1: 20 + Phase 2: 6 + Phase 3: 17）

**2026-07-06 全系統程式碼審查**：修正節流自動恢復、`/api/history` rate limit、
token 時序攻擊防護、UTC 日期偏移、Playwright 依賴缺失等 12 項問題。
環境變數規劃已對齊附錄 B——範本見 `backend/.env.example`、`frontend/.env.example`，
Zeabur / Cloudflare Pages 部署對照表與順序見根目錄 `DEPLOYMENT.md`。

**2026-07-07 備援 provider 轉向：Amadeus → Kiwi.com**。Amadeus 自助 API portal
於 2026-07-17 全面停用且新註冊早已關閉，備援 provider 改接 Kiwi.com 官方公開
MCP 端點（`https://mcp.kiwi.com/`，免金鑰、原生 TWD、已實測 TPE→NRT 回 15 筆）。
`providers/kiwi_provider.py` 取代 `amadeus_provider.py`，保留 G3 配額自律
（`KIWI_MONTHLY_QUOTA=3000`）、熔斷器、retry 與 FX 兜底；`schema_v3.sql` 已套用。
計畫書內所有 Amadeus 相關驗收項（附錄 F 閘門、`AMADEUS_ENV` 切換）作廢，
對應驗收改為：Kiwi 切換實測。測試維持 42 passing。

**2026-07-07 全案穩定性複審（第二輪）**：後端本地實際啟動、全 API 逐項實測
＋前端重建＋Playwright E2E 真瀏覽器驗證（本地 Kiwi MCP stub 模擬備援）。
發現並修復 3 個問題：
1. 🔴 **CORS preflight 被 token 中介軟體擋下（會炸正式環境）**——瀏覽器帶
   `X-API-Token` 前必發 OPTIONS preflight 且依規範不帶自訂標頭，中介軟體
   一律回 403 導致前端所有 API 呼叫被瀏覽器封鎖。已修：OPTIONS 放行給
   CORSMiddleware，並加回歸測試（43 passing）。
2. `playwright.config.ts` 的 `executablePath` 誤放在 `use` 層（無效選項），
   移入 `launchOptions`。
3. 前端 3 處 Amadeus 殘留（結果來源標籤、價格趨勢圖線、頁尾）改 Kiwi.com。
實測結果：health 200／token 403／非法參數 422×5／history 無 DB 503／
rate limit 20-min 準點 429／failover fast_flights→kiwi 200（source=kiwi）／
查詢中 health 12ms 不阻塞／E2E chromium 4/4 綠。

**2026-07-07 API 引用＋UX/UI 全面複審（第三輪）**：Kiwi 官方 MCP schema 逐欄比對
（`flyFrom`/`flyTo`/`departureDate` dd/mm/yyyy/`cabinClass` M-W-C-F/`currency`）＋
真實 TPE→NRT 呼叫驗證回傳欄位（15 筆、TWD、`segments[].carrier/flightNumber`
與 parser 完全一致）。真瀏覽器截圖逐一目視 9 個畫面狀態，發現並修復 3 個問題：
1. 🔴 **中文機場搜尋完全無效**——airports.json 3274 筆零中文，輸入「東京」
   下拉不會出現。修復：`build-airports.mjs` 加入 105 個主要機場中文別名
   （台日韓港澳中東南亞美加歐澳，繁簡並收），Fuse 搜尋鍵加 `zh`，下拉顯示
   「東京（Narita）」格式；JSON 278.3 KB 仍低於 300 KB 上限。
2. **前端 fetch 無逾時**——後端若掛住（非拒絕連線），使用者永遠停在骨架屏。
   修復：`/api/search` 45s、`/api/history` 15s `AbortSignal.timeout` 兜底。
3. **趨勢圖 fetch 拋錯未接**——斷網時 unhandled rejection。修復：try/catch
   靜默回空陣列。
目視確認畫面：首頁／中文 autocomplete（東京→HND+NRT）／loading 骨架屏／
結果卡片＋排序／趨勢累積中／空結果＋前後一天鈕／錯誤＋重試＋狀態燈轉紅／
手機 375px 首頁＋結果頁。E2E 4/4 綠（空結果路徑本輪起由 stub 真實觸發）、
tsc 無錯、後端 43 tests 維持全綠。

---

## Phase 0：環境準備 🧑

- [x] GitHub repo（monorepo：`/backend`、`/frontend`）— repo 已存在
- [x] Supabase 建專案 `flight-search`（ap-northeast-1）— `SUPABASE_URL=https://abbjtfnbzxwxkrurijvl.supabase.co`；🧑 `SUPABASE_SERVICE_KEY` 需自 Dashboard → Settings → API 取得後填入部署環境變數
- [x] ~~Amadeus 註冊~~ 作廢（2026-07-17 portal 停用）→ 改用 Kiwi.com 公開 MCP，免註冊免金鑰
- [x] 下載 OurAirports `airports.csv` 放進 `/data`（CSV 不入版控，見 `data/README.md`）
- [x] 產生 API Token（2026-07-07 已產生並交付；🧑 存入密碼管理器＋部署時填 `API_TOKEN`）
- [x] ~~Amadeus test key 換 OAuth token~~ 作廢（同上）
- [ ] `git tag phase-0-done`

---

## Phase 1：雙 provider 最小骨架＋切換鏈 ✅（程式碼）

**已交付程式碼**
- [x] `providers/base.py`：`Flight` / `SearchResult` / `FlightProvider` 抽象
- [x] `providers/fast_flights_provider.py`：`asyncio.to_thread` 包裝、Semaphore(1)＋3–6s jitter
- [x] ~~`providers/amadeus_provider.py`~~ → 2026-07-07 改為 `providers/kiwi_provider.py`（Kiwi.com 公開 MCP、免金鑰、原生 TWD）
- [x] `services/search_chain.py`：順序 failover、空結果視為成功（G2）
- [x] `main.py`：`/api/search`（參數驗證）、`/api/health`、全域錯誤處理
- [x] `Dockerfile` / `requirements.txt` / `.env.example`

**查核點**
- [x] `pytest` 全綠（19）
- [x] Code review：`main.py` 不 import `fast_flights` / `httpx`（全封裝）
- [x] 無硬編碼金鑰
- [ ] 🧑 `/api/search` 回傳 `source: fast_flights`、每筆 `currency` 為 TWD（沙箱網路擋 Google，僅能於部署後驗；kiwi 路徑已驗 TWD ✓）
- [x] 切換實測：fast-flights 失敗 → 回 `source: kiwi` ✓（2026-07-07 沙箱實測，正式環境部署後再驗一次）
- [x] 非法參數 422 ✓（5 種情境實測）；🧑 `docker build` 容器內查詢（沙箱無 docker，部署時驗）
- [x] 阻塞實測：查詢中 `/api/health` 12ms 回應 ✓（2026-07-07）
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
- [x] 執行 `db/schema.sql` + `db/schema_v2.sql`（經 MCP migration）：四張表就緒、`tracked_routes` 三筆種子、`provider_status` 兩筆種子
- [ ] 🧑 設定 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（URL 已知；service key 待取得）
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
- [x] 備援 provider 配額保護（現為 Kiwi）：G3 先計數後呼叫、月輪替、90% 停用（`QuotaExceeded`）
- [x] API 防護：`X-API-Token` 中介軟體（/health 豁免）、slowapi 20/min
- [x] 每日排程：APScheduler 09:00 Asia/Taipei、misfire_grace_time=3600、冪等
- [x] 節流模式：封鎖訊號偵測 → `_throttled`、TTL 拉長至 180min
- [x] tenacity `AsyncRetrying` ×2（fast_flights + 備援 provider）
- [x] pytest：8 熔斷情境 + 8 Phase 3 情境（共 41 tests passing）

**查核點**
- [ ] 🧑 熔斷實測、重啟狀態一致、配額停用、節流、排程（token 403 ✓、rate limit 429 ✓ 已於 2026-07-07 實測）
- [x] ~~附錄 F 閘門判定~~ 作廢（Amadeus 停用；Kiwi 無 test/production 之分）
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
- [x] 下載 `airports.csv` → `npm run build:airports`：JSON 278.3 KB（3274 機場＋105 中文別名）；NRT/TPE/FUK/WAW 皆在；「東京」→HND+NRT 中文模糊搜尋已目視確認 ✓（2026-07-07 第三輪）
- [x] 完整搜尋流程目視；URL 直開自動搜尋 ✓（2026-07-07 真瀏覽器截圖）
- [x] 四狀態逐一目視 ✓（loading 骨架屏／結果卡片／空結果＋前後一天鈕／錯誤＋重試；stale 黃色警示由測試覆蓋，正式環境再目視）
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
- [ ] 🧑 線上熔斷演練：暫壞 fast-flights → 自動切 Kiwi → 還原
- [ ] 🧑 無 token 掃描被 403；Playwright 全綠
- [ ] 🧑 隔日確認排程自動寫入三條航線歷史
- [ ] 🧑 **【結案封鎖】熔斷演練用 Kiwi 真實報價通過（原附錄 F／`AMADEUS_ENV` 閘門因 Amadeus 停用作廢）**
- [ ] 🧑 UptimeRobot 連續 7 天 ≥ 99% → `git tag v1.0.0` **結案**

---

## 待人工操作彙總（阻擋後續 Phase 的關鍵項）

| 優先 | 項目 | 阻擋 |
|---|---|---|
| 🔴 高 | 自 Supabase Dashboard 取得 `SUPABASE_SERVICE_KEY` | Phase 2 驗收、Phase 3 排程 |

已完成（2026-07-07）：Supabase 專案 `flight-search` 建立＋schema v1–v3 套用＋RLS 啟用；`airports.csv` 下載＋`airports.json` 產出（275.7 KB）；API Token 產生；備援 provider Amadeus → Kiwi.com 轉向（42 tests passing）。
