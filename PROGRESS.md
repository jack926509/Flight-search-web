# 專案進度追蹤 Checklist

> 依據《機票快速搜尋系統建置計畫書 v2.4》各 Phase 查核點整理。
> 狀態圖例：✅ 已完成　🔶 進行中／待人工驗收　⬜ 未開始　🧑 需人工操作
> 最後更新：2026-07-11

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

**目前測試總數：53 passing**（Phase 1: 20 + Phase 2: 9 + Phase 3: 17 +
Phase 4 追蹤功能 `test_trackers.py`: 7；2026-07-10 實跑
`.venv312/bin/python -m pytest -q` 確認）

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

**2026-07-07 異常處理複審（第四輪）＋處理手冊**：新增 **`TROUBLESHOOTING.md`**
（所有異常狀況的症狀→原因→自動恢復→手動解法＋快速診斷指令）。
以「填錯 SUPABASE_URL」實測 DB 死亡情境，發現並修復 5 個韌性問題：
1. 🔴 **DB 掛掉會拖垮搜尋**——`cached_search` 快取讀寫無錯誤保護，Supabase
   故障時 `/api/search` 直接 500（即使兩個資料源都正常）。修復：讀取失敗視為
   miss、寫入失敗 non-fatal、全部套 8s 硬性逾時；DB 死亡實測搜尋照常回
   `source=kiwi`（9.8s）。
2. 🔴 **`ping_db` 無逾時**——DB 連線黑洞時 `/api/health` 掛住 >10s，監控會
   誤判整個服務死亡。修復：5s 逾時；實測 health 0.3s 回 `db:false`。
3. `/api/history` DB 故障回 500／掛住 → 改 8s 逾時＋503。
4. Kiwi 配額檢查無逾時（DB 掛住卡死備援路徑）→ 8s 逾時兜底。
5. 排程 `has_history_today` 例外被 `gather(return_exceptions=True)` 靜默吞掉
   → 移入 try 塊確保留 log。
前端異常體驗同步強化：錯誤訊息全面中文化＋行動指引（連線逾時／無法連線／
Token 不符／太頻繁／查詢條件有誤／兩資料源皆失效，各自對應解法）；
右上系統狀態燈改接真實 `/api/health`（每 60s 輪詢）三態顯示：
🟢正常／🟡部分異常（DB 離線，目視已驗）／🔴異常（後端無回應，目視已驗）。
新增 3 個 DB 韌性回歸測試（46 passing）、E2E 4/4 綠、tsc 無錯。

**2026-07-07 新功能：多段行程查詢（外站票／四腿票）＋全案盤點（第五輪）**。
研析結論：外站／四腿實務上為分段購票（各段獨立機票），聯程四腿票價無公開
API 可查；Kiwi MCP 僅支援單程/來回、fast-flights multi-city 不穩定——故以
「2–4 段獨立單程並行查詢＋可選報價＋總價加總」實作，每段完整重用既有
快取／雙 provider failover／熔斷／stale 兜底，**後端零改動**。前端新增：
- 查詢模式切換：單程查詢｜多段行程（外站・四腿）
- `useMultiSearch` hook：2–4 段管理、各段獨立狀態（並行查詢、逐段顯示）、
  報價點選、總價計算、URL 深連結（`?mode=multi&legs=TPE-NRT@日期|…`）自動查詢
- `MultiSearchCard`：航段增刪（新段自動帶上一段目的地）、共用人數/艙等
- `MultiLegResults`：各段 price 排序可選清單（radio 樣式）、來源標籤、
  段級錯誤重試／空結果／stale 標註、總價列（未報價段提示不計入）、
  分段購票風險提示（行李重掛、誤機自負、簽證、順序使用）
盤點結果：後端 46 tests 綠（零改動）、tsc 無錯、bundle 122KB（<150KB 目標，
僅 +4KB）、無 TODO/console.log 殘留、E2E 6/6 綠（新增 (d) 多段總價驗證＋
375px 多段無橫捲）；目視確認：多段表單／雙段結果＋總價 9,682／點選第二報價
總價變 9,850／手機版逐段載入＋輸入框寬度修復（發現後已修）。

**2026-07-07 外站票飛法強化：日期組合比價矩陣（第六輪）**。第三查詢模式
「外站組合比價」：段1（定位航段）＋段2（外站出發段）各設基準日期＋彈性
±0–3 天，把所有日期組合的總價排成矩陣，一眼比出「哪天去＋哪天回」最低。
流量設計（配合既有防護）：查詢數＝兩段日期數相加（線性，上限 7+7=14 次
< rate limit 20/min）、前端並發 2 佇列（fast-flights Semaphore 之後不逾時）、
矩陣逐格填入＋進度指示、已查日期吃快取、順便累積價格歷史。實作：
- `useComboSearch`：日期展開（過濾今天以前）、worker pool、搜尋當下條件
  快照（改表單不弄髒已顯示矩陣）、URL 深連結
  （`?mode=combo&a=TPE-BKK@日期~2&b=BKK-TPE@日期~2`）自動查詢
- `ComboSearchCard`：兩段設定（含用途提示例）、彈性天數選單、查詢次數預告
- `ComboMatrix`：總價矩陣（列＝段1日期、欄＝段2日期）、段2早於段1標
  「—」不可行、無班／✕失敗標記、最低組合綠標＋🏆摘要列、點格看兩段明細、
  外站票 no-show 風險提示
盤點：後端 46 tests 綠（零改動）、tsc 無錯、bundle 125KB（<150KB）、
E2E 7/7 綠（新增 (e) 矩陣＋最佳組合＋不可行格＋明細驗證）、桌機／手機
目視確認（手機矩陣容器內橫捲、頁面無橫捲）。

**2026-07-10　新功能：站內匿名機票價格追蹤（第七輪）**。新增
`price_trackers`／`tracker_events` 兩張表（`backend/db/schema_v5.sql`）：
`price_trackers` 存追蹤條件（單程／來回、出發回程日期、人數、艙等、目標價、
目前價、前次價），`tracker_events` 存通知事件（`target_price` 低於目標價／
`price_drop` 較前次降價），兩表皆開 RLS 並加限制性 policy 全鎖
`anon`／`authenticated`，僅後端 `service_role` 可存取（瀏覽器端不直連）。
匿名機制：`backend/services/tracker_service.py` 產生 `trk_` 開頭追蹤金鑰
（`secrets.token_urlsafe`）、SHA-256 雜湊後存 `tracker_key_hash`，免登入即可
建立與查詢自己的追蹤項目。每日排程新增 `_tracker_job`
（`backend/services/scheduler.py:53-61`，`create_scheduler` 於
`backend/services/scheduler.py:74-81` 註冊為 10:00 Asia/Taipei、
`misfire_grace_time=3600`）：呼叫 `check_all_trackers` 逐筆比價，命中降價或
低於目標價即寫入 `tracker_events`。前端新增：
- `useTrackers` hook（`frontend/src/hooks/useTrackers.ts`）：本機
  `localStorage` 存匿名追蹤金鑰、CRUD 追蹤項目、讀取事件與未讀計數
- `TrackerDrawer` 元件（`frontend/src/components/TrackerDrawer.tsx`）：
  側欄列出追蹤中航線、事件通知列表、開關／標記已讀／刪除
- `frontend/src/lib/trackers.ts`：`trackers` API 呼叫封裝（CRUD）
後端測試新增 `tests/test_trackers.py`，實跑
`.venv312/bin/python -m pytest -q`：**53 passed**（原 46 → +7）。

**2026-07-10～07-11　Cloudflare Pages Function 代理擴充**：新增
`frontend/functions/_proxy.js`（`onRequest`）統一代理
`/api/{health,search,history,trackers}`，依方法白名單轉發後端
（`trackers` 額外開放 `POST`／`PATCH`／`DELETE`，其餘端點僅 `GET`）並附加
安全標頭；`frontend/functions/api/[[path]].js` re-export 同一個
`onRequest` 作為 Cloudflare Pages Functions 實際部署入口（原本缺此檔導致
Functions 未生效，commit `d747788` 修正）。同一天一併完成來回航班查詢
（`RoundTripResults` 等元件）與航空公司中文名稱／標誌顯示，屬另一批功能，
不在本次補記範圍，細節見 git commit 歷史（`470dfa6`、`c6ed6a6`、
`17a539b`）。

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
- [x] health 保活實測：填錯 `SUPABASE_URL` → `db: false`（0.3s 回應）✓；DB 死亡時搜尋降級直查照常成功 ✓（2026-07-07 第四輪實測）
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

## Phase 5：部署＋E2E＋監控＋最終驗收 🔶

**已交付程式碼**
- [x] Playwright E2E 七條測試（含 G4 流量自律：用快取日期避免觸發真實 provider）
  - (a) TPE→NRT 出現 ≥1 張卡片
  - (b) 切換排序後首卡符合排序邏輯
  - (c) 無航班路線走到空結果畫面＋前後一天快捷鈕
  - (d) 多段行程總價驗證
  - (e) 外站組合比價矩陣、最佳組合、不可行格與明細驗證
  - 375px 單程／多段／矩陣無頁面橫向捲軸
- [x] 安全補強：前端 production 改走 Cloudflare Pages `/api/*` proxy，不再把 API token 打包進瀏覽器 JS；Cloudflare `_headers` 與後端安全標頭已加入
- [x] Supabase 權限補強 migration 已套用：`backend/db/schema_v4.sql`（server-only tables 對 anon/auth 明確拒絕；advisors 0 筆）

**待人工操作**
- [x] Zeabur 部署 `/backend`（Docker / FastAPI / uvicorn）— `https://flight-search-api.zeabur.app`（服務 `flight-search-api`，deployment `6a4e5bfdd5520eae64fa38dc`）
- [x] Cloudflare Pages 設定 `FLIGHT_SEARCH_API_URL` / `FLIGHT_SEARCH_API_TOKEN` 並重新部署 `/frontend` + `functions/` — `https://68df4ee8.flight-search-web-29x.pages.dev`
- [x] 後端 CORS 只允許 Pages 網域（production + deployment preview）
- [ ] 🧑 UptimeRobot 打 `/api/health`（5 分鐘）

**最終驗收（=第 0 章成功標準）**
- [x] 快取 <1s／未命中 <8s（正式 API 實測：第一次 `fast_flights` 11 筆，第二次 `cache` 11 筆）
- [ ] 🧑 線上熔斷演練：暫壞 fast-flights → 自動切 Kiwi → 還原
- [x] 無 token 掃描被 403；Playwright 375px production 煙霧測試通過
- [x] 隔日確認排程自動寫入航線歷史（2026-07-08 已由正式 API `/api/history?route=TPE-NRT&days=7` 讀到 1 筆，latest=`2026-07-08`；Supabase API logs 顯示 TPE-NRT / TPE-FUK / TPE-WAW 皆有當日寫入）
- [ ] 🧑 **【結案封鎖】熔斷演練用 Kiwi 真實報價通過（原附錄 F／`AMADEUS_ENV` 閘門因 Amadeus 停用作廢）**
- [ ] 🧑 UptimeRobot 連續 7 天 ≥ 99% → `git tag v1.0.0` **結案**

---

## 待人工操作彙總（阻擋後續 Phase 的關鍵項）

| 優先 | 項目 | 阻擋 |
|---|---|---|
| 🟡 中 | UptimeRobot 監控 `/api/health` | 7 天可用率結案 |
| 🟡 中 | 線上熔斷演練（暫壞 fast-flights → Kiwi） | 最終驗收 |

已完成（2026-07-08）：Supabase 專案 `flight-search` 建立＋schema v1–v3 套用＋RLS 啟用；`airports.csv` 下載＋`airports.json` 產出（275.7 KB）；API Token 產生；備援 provider Amadeus → Kiwi.com 轉向；Zeabur 後端 `flight-search-api` 與 Cloudflare Pages 前端已部署並通過 smoke verification；排程歷史寫入已驗證。

---

## Roadmap（2026-07-11 訂定，四階段全案優化）

> 依據《Flight-search-web 全面優化計畫》，順序：先穩定、再修功能、最後改版
> UI，Phase 4 為候選清單待挑選。詳細規格見
> `~/.claude/plans/1-uxui-2-a-icon-b-wiggly-moler.md`。

- **Phase 1 — 穩定性**（零程式風險，優先做）：UptimeRobot 打
  `/api/health`（5 分鐘一次，同時防 Zeabur 休眠與 Supabase 免費版 7 天無
  流量自動 pause）；更新本檔 `PROGRESS.md` 補記追蹤功能與 roadmap（本次即為
  此項）。
- **Phase 2 — 功能修正**（三項獨立、可並行）：(2-A) 航空公司 logo 換
  `pics.avs.io` CDN＋中文對照擴充至 40+ 家；(2-B) 去／回程結果桌機改左右
  雙欄（手機仍上下堆疊）；(2-C) 價格追蹤加主動推播——新增
  `schema_v6.sql`（`tracker_events.notified`）、
  `backend/services/notifier.py`、排程 `_tracker_job` 尾端接
  `notify_pending_events`（需使用者提供 `LINE_CHANNEL_ACCESS_TOKEN`／
  `LINE_TARGET_USER_ID`）。2026-07-11 改版：推播管道由 Telegram 改為
  LINE（`send_line()`，照 tw-stock-tracker 的 `pushLine()` 模式移植），
  單次批次上限 10 則。
- **Phase 3 — UI/UX 改版**：明亮現代旅遊感（漸層點綴＋浮層玻璃質感），
  `tailwind.config.ts` 加設計 token，逐元件套用（`SearchPage`、
  `SearchCard`、`ResultsSection`、`FlightCard`、`TrackerDrawer` 等），
  className 為主、不動邏輯。
- **Phase 4 — 新功能候選**（進階使用者視角，供挑選、非本輪全做）：搜尋結果
  分享連結、結果篩選器（直飛／航空公司／時段）、provider 狀態可視化
  （Kiwi 配額曝光）、深色模式、PWA 安裝、彈性日期比價矩陣；建議首波挑
  分享連結＋篩選器＋provider 狀態可視化（純前端、零配額成本）。
