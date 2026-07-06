# 機票快速搜尋系統建置計畫書 v2.4

| 項目 | 內容 |
|---|---|
| 版本 | v2.4（情境推演修訂：新增附錄 G 風險清單；修正 price_history 污染與空結果語意兩個規格級 bug） |
| 日期 | 2026-07-06 |
| 開發工具 | Claude Code（後端／整合）＋ Codex（前端） |
| 部署 | 後端 Zeabur **付費方案（已到位，US$5/月，資源有保證）**、前端 Cloudflare Pages |
| 資料庫 | Supabase Free |
| 月成本 | **US$5（既有 Zeabur），無其他必要花費**；proxy 為純選配（見 §5.5，預設不採用） |

## v1.0 → v2.0 修訂總覽

| # | 修訂 | 原因 |
|---|---|---|
| 1 | Phase 1 改為「雙 provider 最小實作＋切換鏈」 | fast-flights 是最大單點，第一天就要驗證「切換」這個核心機制，而非把單一來源做深 |
| 2 | Amadeus **直上 production key**，test 只驗 OAuth | test 環境回快取假資料，用它驗收會產生錯誤信心；移轉 production 免費且保留免費配額 |
| 3 | 新增每日排程主動抓追蹤航線 | 只靠被動搜尋，價格歷史累積太慢；付費 Zeabur 容器穩定，直接用 APScheduler 進程內排程，不需外部 cron |
| 4 | 新增 API Token + Rate Limit | API 公開部署會被白嫖爬蟲與 Amadeus 配額 |
| 5 | Provider 層強制處理幣別 | fast-flights 幣別受 locale 影響，不能假設回傳即 TWD |
| 6 | 機場資料明定 OurAirports 開源 CSV | autocomplete 資料來源落地 |
| 7 | Phase 5 加 Playwright E2E | 驗收不能全靠人工，改版後 10 分鐘回歸 |
| 8 | 每 Phase 通過即 `git tag phase-N-done` | 查核點＝存檔點，AI 繞圈時可回滾 |
| 9 | 新增附錄 D〈AI 卡關處理 SOP〉 | 三次法則等除錯方法論制度化 |
| 10 | 選配層：residential proxy、SerpAPI 免費 100 次/月第四層備援 | 花小錢買主源存活率；免費額度留急用 |
| 11 | **(v2.1)** 熔斷器設計改為「附錄 E 審定規格」，AI 照規格實作＋自我核對表 | 原本要人工審設計，現規格已預先審定，含狀態機、邊界條件與失敗模式 |
| 12 | **(v2.1)** Amadeus production 切換改為「附錄 F 機械化閘門」 | 用一條 curl 判定，通過即切、未過即遞延並封鎖結案，全程無需人為判斷 |
| 13 | **(v2.2)** proxy 降為純選配，新增 §5.5「零 Proxy 生存策略」（$0） | 被封的後果本有四層降級兜底；以保守請求、節流模式、換 IP 三招取代付費 proxy |
| 14 | **(v2.3)** Phase 1 Prompt 明令 fast-flights 以 `asyncio.to_thread` 包裝 | fast-flights 是同步套件（實測 3.0.2 無 async API），直接在 event loop 呼叫會阻塞單 worker 的所有請求——這是最容易踩、AI 不會自己想到的坑 |
| 15 | **(v2.3)** 附錄 A schema 補 `throttled` / `throttled_until` 欄位 | 與 Phase 3 §5b 節流模式對齊，附錄 A 應為最終態 |
| 16 | **(v2.3)** 每日排程改為「冪等補跑」設計＋health 必須真實觸及 Postgres | 容器重啟窗口可能漏跑整天；health 若只回記憶體狀態，Supabase 防休眠保活即失效 |
| 17 | **(v2.3)** Amadeus 定位由「備援」升格為「共同主源」心態；§5.5 補述機房 IP 風險 | 封鎖關鍵是 datacenter IP 信譽而非請求節奏，jitter 偽裝效果有限，Amadeus 接手頻率可能高於預期——不改架構，改預期 |
| 18 | **(v2.3)** 防線 #9 措辭校準；附錄 D 回滾補 schema 警語；SerpAPI 明定僅留 stub | token 編入前端 bundle 即公開，防的是路過掃描不是盜用；git reset 不會回滾 DB schema；第四層預期用不到就不先實作 |
| 19 | **(v2.4)** price_history 只收「1 人經濟艙」基準查詢；空結果 ≠ 失敗（不 failover、不計熔斷） | 商務艙查詢會把虛高價寫進「最低價」趨勢；空結果觸發 failover 會白燒 Amadeus 配額並誤觸熔斷——兩者都是上線才會發現的規格 bug |
| 20 | **(v2.4)** 新增附錄 G〈情境風險清單〉共 14 條，附各 Phase Prompt 對應補丁 | 以「上線跑 30 天會在哪出事」推演：配額計數 crash 窗口、E2E 流量自傷、深層連結不可行、跨源趨勢跳動、XFF 偽造等 |

---

## 0. 目標與成功標準

**一句話目標**：個人用機票快速搜尋網站，3 秒內回快取結果、8 秒內回即時結果，並每日自動累積追蹤航線價格趨勢。

**成功標準（最終驗收逐項確認）**：

- [ ] 快取命中 < 1 秒、未命中 < 8 秒
- [ ] fast-flights 失效自動切 Amadeus（production 真實資料），使用者無感
- [ ] 全資料源失效時回過期快取＋明確標註，不出現白畫面
- [ ] 未帶 API token 的請求被拒（403），rate limit 生效
- [ ] 追蹤航線（TPE-WAW、TPE-NRT、TPE-FUK）每日自動記錄最低價
- [ ] Playwright E2E 全綠；手機 375px 實機可完整操作
- [ ] 連續 7 天可用率 ≥ 99%

---

## 1. 系統架構

```
使用者
  │
  ▼
Cloudflare Pages（前端：Next.js 15 靜態輸出，$0）
  │  HTTPS + X-API-Token
  ▼
Zeabur 付費容器（後端：Python 3.12 + FastAPI）
  ├── 中介層：API Token 驗證 + IP Rate Limit（slowapi）
  ├── GET /api/search      四層查詢鏈（見下）
  ├── GET /api/history     價格歷史
  ├── GET /api/airports    OurAirports 靜態 JSON autocomplete
  ├── GET /api/health      各資料源健康＋配額狀態
  └── APScheduler          每日 09:00 抓追蹤航線 → 寫快取＋歷史
  │
  ▼
Supabase Free（search_cache / price_history / provider_status / tracked_routes）
```

**四層查詢鏈**：

```
1️⃣ Supabase 快取（未過期）→ source: cache
2️⃣ fast-flights（保守請求策略，見 §5.5）→ 寫快取＋歷史
3️⃣ Amadeus Self-Service（production）→ 熔斷觸發時接手
4️⃣ SerpAPI（選配，免費 100 次/月，僅緊急兜底；Phase 1–3 只留 provider 介面 stub 不實作——其回傳格式與前兩源差異大，轉換層成本不小，預期用不到就不預付）
🆘 全失敗 → 過期快取 + stale: true + 資料時間
```

**Zeabur 付費方案帶來的架構調整**：容器資源有保證後，(a) 排程直接用 APScheduler 進程內執行，省去 GitHub Actions 與後端間的認證繞路；(b) 可安心開 uvicorn 單 worker 常駐，不必遷就免費層的冷啟動。狀態仍全數外置 Supabase，維持無狀態設計——付費不改變「重啟零影響」原則。

---

## 2. 成本總表

| 層 | 技術 | 月成本 |
|---|---|---|
| 前端 | Next.js 15 + Tailwind + Recharts @ Cloudflare Pages | $0 |
| 後端 | FastAPI @ Zeabur 付費方案 | **US$5（已到位）** |
| 資料庫 | Supabase Free | $0 |
| 資料源 | fast-flights + Amadeus production 免費配額 | $0 |
| 監控 | UptimeRobot Free | $0 |
| 選配① | ~~Rotating residential proxy~~ → **改採 §5.5 零 Proxy 生存策略** | **$0**（proxy 僅在 §5.5 三招全部無效時才考慮，預期用不到） |
| 選配② | SerpAPI 免費層 | $0（100 次/月，勿升付費） |

---

## 3. 開發流程（含每步 Prompt 與查核點）

> **鐵律一**：每 Phase 查核點全過才進下一 Phase，通過即 `git tag phase-N-done`。
> **鐵律二**：AI 修同一 bug 三次未果，停手，改走附錄 D 的 SOP。
> 所有 Prompt 已內建 Karpathy 紀律。

---

### Phase 0：環境準備（人工，約 1 小時）

1. GitHub repo `flight-search`（monorepo：`/backend`、`/frontend`）
2. Supabase 建專案，記下 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`
3. Amadeus 註冊 → 建 app → **立即申請移轉 production**（簽線上合約＋填帳單資料，免費、保留免費月配額）。等待審核期間可先用 test key 驗 OAuth 流程
4. 下載 OurAirports `airports.csv`（https://davidmegginson.github.io/ourairports-data/airports.csv），先放進 repo `/data`
5. 產生一組隨機 API Token（`openssl rand -hex 24`）記入密碼管理器

**✅ 查核點**：

- [ ] repo 可 push；Supabase SQL Editor 可用
- [ ] Amadeus test key 以 curl 成功換得 OAuth token；production 申請已送出
- [ ] 本機 `pip install fast-flights` 跑通一次 TPE→NRT
- [ ] `airports.csv` 已入 repo；API Token 已產生
- [ ] `git tag phase-0-done`

---

### Phase 1：雙資料源最小骨架＋切換鏈（Claude Code，1 天）

> v2 核心變更：第一天就把「兩個 provider ＋ failover」跑起來，切換機制是本案地基。

**📋 Prompt（複製給 Claude Code）**：

```text
你是資深 Python 後端工程師。遵循 Karpathy 紀律：先想清楚再寫、
最簡實作、不做未要求的功能。請先用 5-10 行說明你的模組切分再動手。

在 /backend 建立 FastAPI 專案（Python 3.12、requirements.txt、
Dockerfile: python:3.12-slim + uvicorn，讀 PORT 環境變數）：

【1. Provider 抽象層】
- providers/base.py：抽象類 FlightProvider
  async def search(origin, dest, date, adults=1, cabin="economy") -> SearchResult
- SearchResult (Pydantic)：
  flights: list[Flight]（airline, flight_no, depart_time, arrive_time,
  duration_min, stops, price: int, currency: str, booking_hint）
  source: str, fetched_at: datetime
- 【幣別鐵則】每個 provider 必須明確回報 currency，不得假設。
  fast-flights 呼叫時鎖定 currency 參數/locale 為 TWD；
  若上游仍回其他幣別，在 provider 內以環境變數 FX_USD_TWD 等
  簡單匯率換算並在 Flight 加 original_currency 欄位註記。

【2. 兩個最小 provider】
- providers/fast_flights_provider.py：fast-flights 套件。
  【async 鐵則】fast-flights 是同步阻塞套件（無 async API），
  必須以 asyncio.to_thread() 包裝呼叫，嚴禁在 event loop 內
  直接同步呼叫——單 worker 下會卡死所有請求。
  asyncio.Semaphore(1) 單併發＋每次請求前 asyncio.sleep 3-6 秒
  隨機 jitter（偽裝人類節奏，這是零 proxy 策略核心）；
  HTTPS_PROXY 環境變數留鉤子但預設不用
- providers/amadeus_provider.py：httpx 直呼 Self-Service
  GET /v2/shopping/flight-offers（currencyCode=TWD, max=20），
  OAuth token 記憶體快取（到期前 60 秒更新），
  base URL 依 AMADEUS_ENV（test/production）切換

【3. 最小切換鏈】services/search_chain.py：
  依序嘗試 [fast_flights, amadeus]，前者拋例外即嘗試下一個；
  全失敗拋 AllProvidersFailed。（完整熔斷 Phase 3 才做，現在只要順序 failover）

【4. API】
- GET /api/search（Pydantic 驗證：IATA 三碼大寫、日期≥今天、adults 1-9）
- GET /api/health：各 provider 名稱與 reachable 布林
- 全域例外處理：回 {"error":{"code","message","retryable"}}，不漏 traceback

【5. 測試】pytest：參數驗證、兩 provider 的回應轉換（mock）、
  failover 順序（fast_flights mock 拋錯 → 走 amadeus）

【禁止】不引入資料庫、不做認證、不裝 Amadeus 官方 SDK
```

**✅ 查核點**：

- [ ] `/api/search` 正常回傳，`source: fast_flights`，每筆航班 `currency` 欄位為 TWD（目視原始 JSON 確認幣別鐵則落實）
- [ ] **切換實測**：暫時把 fast-flights provider 改成必拋錯 → 同一查詢回傳 `source: amadeus`（test 環境假資料 OK，此處只驗切換）→ 還原
- [ ] 非法參數 422；`pytest` 全綠；`docker build` 且容器內可查詢
- [ ] Code review：核心路由不 import fast_flights / httpx（全封裝在 provider）
- [ ] **阻塞實測**：一邊跑 `/api/search`（fast-flights 查詢中）、同時打 `/api/health` 必須 <1 秒回應——證明 to_thread 包裝生效、event loop 未被阻塞
- [ ] `git tag phase-1-done`

---

### Phase 2：Supabase 快取層＋價格歷史＋Stale 兜底（Claude Code，0.5 天）

**📋 Prompt（複製給 Claude Code）**：

```text
延續 /backend。遵循 Surgical Changes，只動需要的檔案。

【1. Supabase 整合】supabase-py，環境變數 SUPABASE_URL / SUPABASE_SERVICE_KEY
【2. db/schema.sql】（我手動貼 SQL Editor 執行）：
- search_cache(cache_key unique, payload jsonb, source, created_at, expires_at)
  cache_key = "{origin}:{dest}:{date}:{adults}:{cabin}"
- price_history(route, date, lowest_price_twd, source, recorded_at)
- tracked_routes(route text primary key, enabled bool default true)
  並 INSERT 三筆種子：TPE-WAW, TPE-NRT, TPE-FUK
- 適當 index（cache_key、expires_at、route+date）
【3. 查詢鏈改 cache-aside】
a. 未過期快取 → 回傳（source: "cache"）
b. 未命中 → 走 Phase 1 切換鏈 → 成功寫快取（TTL 由 CACHE_TTL_MINUTES
   環境變數控制，預設 45）＋ upsert price_history 當日最低價
   【history 基準鐵則】只有 adults=1 且 cabin=economy 的查詢
   才寫 price_history——商務艙/多人的「最低價」會污染趨勢基準
   【空結果語意】provider 正常回傳但 flights 為空 = 成功的空結果，
   直接回傳（前端有查前後日 UI），不得視為失敗觸發下一個 provider
   （否則冷門航線每次查詢都白燒 Amadeus 配額），也不計入熔斷失敗
c. 鏈全失敗且有過期快取 → 回傳並加 "stale": true, "fetched_at"
d. 每次寫入順手 DELETE 過期超過 7 天的快取
【4. GET /api/history?route=TPE-NRT&days=90】
【5. pytest】cache 命中/未命中/stale 三情境（mock supabase client）

【禁止】不動 provider 介面、不開任何公開 RLS
```

**✅ 查核點**：

- [ ] schema 執行成功，Table Editor 見四張表、tracked_routes 有三筆種子
- [ ] 同查詢連打兩次：第一次 source=fast_flights（3–8 秒）、第二次 source=cache（<1 秒）——時間＋欄位雙重確認
- [ ] 手動改某筆 expires_at 為過去＋弄壞兩個 provider → 回 `stale: true`
- [ ] `/api/history` 有資料；`pytest` 全綠
- [ ] `git tag phase-2-done`

---

### Phase 3：穩定性強化包（Claude Code，1 天）

> 熔斷完整版＋配額保護＋API 防護＋每日排程，一次到位。此 Phase 最複雜，
> 熔斷器**設計已預先審定**（附錄 E），AI 不需再提設計、你也不需再審——
> 執行時把附錄 E 全文連同本 Prompt 一起貼給 Claude Code。

**📋 Prompt（複製給 Claude Code，連同附錄 E 全文）**：

```text
延續 /backend。這是穩定性核心。熔斷器不需要你設計——隨附的
〈附錄 E：熔斷器審定規格〉是唯一依據，逐條照做，不得自行變更
狀態機、計數規則或持久化策略。完成後你必須輸出一張「規格對照表」：
附錄 E 每一條編號 → 對應的程式碼位置（檔案:行號）→ 對應的測試名稱。
缺任何一條對照即視為未完成。

【1. 熔斷器】依附錄 E 規格實作（純手寫，不引第三方庫），
  冷卻秒數用環境變數 CB_COOLDOWN_SECONDS（預設 300，測試可調 10），
  provider_status schema 見附錄 E §E7，另存為 db/schema_v2.sql

【2. Amadeus 配額保護】
- 每次呼叫 monthly_calls +1（月份輪替歸零）；
  【計數順序鐵則】先 +1 落庫、再打 Amadeus——呼叫與計數之間
  若容器 crash，寧可多計（保守）不可少計（漏計會突破配額上限
  產生真實費用，production 已綁帳單）
- 達 AMADEUS_MONTHLY_QUOTA 的 90% → 停用 Amadeus、health 顯示 warning
  （寧回 stale 也不產生費用）

【3. API 防護】
- 中介層驗 X-API-Token（環境變數 API_TOKEN），不符回 403；
  /api/health 免 token（給 UptimeRobot），且必須包含一個真實
  Postgres 查詢（如 select count(*) from tracked_routes）——
  這是 Supabase Free 防休眠保活的關鍵，只回記憶體狀態即失效
- slowapi rate limit：每 IP 每分鐘 20 次，超過回 429

【4. 每日排程】APScheduler（AsyncIOScheduler）：
- 每日 09:00（Asia/Taipei）起跑，讀 tracked_routes enabled=true，
  逐條間隔 5–10 分鐘「隨機」錯開（零 proxy 策略：避免規律流量指紋），
  每條查未來 30/60/90 天三個日期，
  寫快取＋price_history
- 【冪等補跑】排程任務本身必須冪等：起跑先查 price_history
  「今日（Asia/Taipei）是否已有該航線紀錄」，有則跳過該條；
  另掛一個每小時的補跑檢查 job——當日 09:00 後任一整點發現
  今日尚無紀錄即補跑（容器若在排程時點重啟也不漏日）；
  misfire_grace_time=3600
- 排程執行紀錄 log 一行 summary；單條失敗不中斷其餘

【5. 重試】各 provider 內 tenacity 最多 2 次、指數退避 1s→2s，
  僅對 timeout/5xx；4xx 不重試直接失敗

【5b. 節流模式（零 proxy 策略）】fast_flights provider 偵測封鎖特徵
  （連續 429，或回應內容含 captcha / unusual traffic 字樣）時：
  - provider_status 標記 throttled=true, throttled_until=now+24h
    （schema_v2.sql 補這兩欄）
  - 節流期間：CACHE_TTL 動態視為 180 分鐘、每日排程跳過
    （改隔日執行）、fast_flights 不參與查詢鏈（視同 OPEN）
  - 期滿自動解除；health 顯示 throttled 狀態
  - 環境變數 THROTTLE_MODE=on 可手動強制進入

【6. pytest】熔斷三態、配額 90% 停用、token 403、rate limit 429、
  排程函式（mock 時鐘與 provider）

【禁止】Amadeus 不得成為預設首選；金鑰只從環境變數讀
```

**✅ 查核點**：

- [ ] AI 已輸出「規格對照表」：附錄 E 的 E1–E10 每條 → 程式碼位置（檔案:行號）→ 測試名稱，無缺項（此表即審核紀錄，存入 PR 描述）
- [ ] 熔斷實測：弄壞 fast-flights 連打 4 次 → 第 4 次 `source: amadeus`、health 顯示 OPEN；`CB_COOLDOWN_SECONDS=10` 下自動恢復 CLOSE
- [ ] 重啟容器 → health 熔斷狀態與重啟前一致
- [ ] `AMADEUS_MONTHLY_QUOTA=1` → 打 1 次後 Amadeus 被停用＋warning
- [ ] 無 token 打 /api/search → 403；60 秒內打 21 次 → 429；/api/health 免 token 可通
- [ ] health 保活實測：暫時填錯 SUPABASE_URL → health 的 db 欄位轉為 unhealthy（證明真的觸及 Postgres，不是回記憶體狀態）→ 還原
- [ ] 冪等實測：手動觸發排程兩次 → price_history 當日每航線仍只有一筆
- [ ] 節流模式實測：mock fast-flights 回 429×2 → provider_status 出現 throttled、health 顯示、查詢鏈跳過 fast_flights；`THROTTLE_MODE=on` 手動觸發亦可
- [ ] 排程觸發時間暫改為 2 分鐘後 → 目視 log 執行、Supabase 三條航線有新歷史資料
- [ ] `pytest` 全綠；grep 全 repo 無硬編碼金鑰
- [ ] 執行附錄 F 閘門判定指令：**通過** → 切 `AMADEUS_ENV=production` 並實測真實報價；**未通過** → 本項標記「遞延」，照常進 Phase 4，Phase 5 結案封鎖條款接手
- [ ] `git tag phase-3-done`

---

### Phase 4：前端 UI（Codex，1–1.5 天）

> 執行前把第 4 章〈UX/UI 設計規劃書〉全文連同本 Prompt 一起貼上。

**📋 Prompt（複製給 Codex / Claude Code）**：

```text
你是資深前端工程師。在 /frontend 建 Next.js 15（App Router、
output:'export' 靜態輸出）+ TypeScript + Tailwind CSS + Recharts。
API base 由 NEXT_PUBLIC_API_URL 提供、token 由 NEXT_PUBLIC_API_TOKEN
提供（個人專案可接受前端持 token，主要防路人掃描）。
依隨附〈UX/UI 設計規劃書〉實作，重點：

【機場 autocomplete 資料】
- 先寫 scripts/build-airports.mjs：讀 /data/airports.csv，
  過濾 type=large_airport|medium_airport 且有 iata_code，
  輸出精簡 JSON（iata, name, city, country）到 public/airports.json，
  前端載入後以 Fuse.js 做中英文/代碼模糊搜尋（客端執行，不打後端）

【頁面】單頁式：搜尋卡片（出發/目的 autocomplete＋⇄對調、
日期 min=today、人數、艙等、CTA）、結果區（卡片＋三種排序 tab＋
資料源標註列）、價格趨勢摺疊區（Recharts、<3 點顯示累積中文案）。
搜尋條件同步 URL query string。

【四狀態必做】loading 骨架屏＋文案輪播 / 空結果＋查前後一天快捷鈕 /
錯誤＋重試（不漏錯誤碼）/ stale 黃色警示列＋重新嘗試鈕

【換算價提示】航班若帶 original_currency 欄位（幣別鐵則的
匯率兜底換算），價格旁顯示小字「約」＋tooltip 註明原幣別

【品質】Lighthouse mobile Perf ≥ 90、A11y ≥ 95；375px 無橫向捲軸、
點擊面積 ≥ 44px；不用 UI 元件庫；Recharts dynamic import
```

**✅ 查核點**：

- [ ] `build-airports.mjs` 產出的 JSON < 300KB；輸入「東京」「NRT」「Tokyo」都找得到成田
- [ ] `next build` 靜態輸出成功；完整搜尋流程 OK；URL 直開自動搜尋
- [ ] 四狀態逐一目視（後端配合模擬）
- [ ] Lighthouse 實測達標（截圖存檔）；鍵盤 Tab 走完全流程
- [ ] `git tag phase-4-done`

---

### Phase 5：部署＋E2E＋監控＋最終驗收（0.5–1 天）

**步驟**：

1. Zeabur 部署 `/backend`（環境變數見附錄 B），綁定付費方案資源
2. Cloudflare Pages 部署 `/frontend`（build：`npm run build`、output：`out`）
3. 後端 CORS 只允許 Pages 網域
4. **Playwright E2E**（請 Claude Code 寫）：三條測試——(a) 搜尋 TPE→NRT 出現 ≥1 張卡片 (b) 切換排序後首卡價格/時間符合排序 (c) 故意打不存在航線走到空結果畫面。`npx playwright test` 一鍵執行，日後每次改版必跑。
   **【E2E 流量自律】**：(a)(b) 固定查追蹤航線＋排程已抓過的日期，讓測試打到快取而非真實資料源——E2E 每跑一輪都打 fast-flights，等於自己製造封鎖風險與 Amadeus 配額消耗；(c) 的「不存在航線」選 IATA 合法但無航班的組合（如 TPE→小型機場），驗證空結果而非參數錯誤
5. UptimeRobot 打 `/api/health`（5 分鐘），此檢查內含輕量 DB 查詢，兼作 Supabase Free 防休眠保活

**✅ 最終驗收（=第 0 章成功標準＋以下）**：

- [ ] 正式網址三航線實測；快取 <1s / 未命中 <8s（Network 面板記錄）
- [ ] 線上熔斷演練：暫壞 fast-flights → 自動切 Amadeus → 還原
- [ ] 無 token 掃描被 403；Playwright 全綠
- [ ] 隔日確認排程有自動寫入三條航線歷史
- [ ] **【結案封鎖條款】附錄 F 閘門已通過、`AMADEUS_ENV=production` 且線上熔斷演練用的是真實報價**——此項未過，即使其餘全綠也不得結案
- [ ] UptimeRobot 首次 Up 通知；連續 7 天 ≥ 99% → `git tag v1.0.0` **結案**

---

## 4. UX/UI 設計規劃書

### 4.1 設計原則

1. **單一任務導向**：首頁即搜尋，無導覽迷宮、無登入。
2. **3 秒原則**：開頁 3 秒內理解「在哪輸入、按哪搜尋」。
3. **永遠有回饋**：>300ms 的等待必有視覺回饋；任何失敗必附下一步（重試／換日期）。
4. **誠實標註資料**：每筆結果標來源與時間，stale 用黃色警示——信任感是留存關鍵。

### 4.2 使用者流程

```
進入首頁 → 填條件 → 搜尋
  ├─ Loading（骨架屏＋文案輪播）
  ├─ 成功 → 結果列表（排序）＋價格趨勢摺疊區
  │        └─ 點卡片 → Google Flights「搜尋頁層級」連結（新分頁）
  │           （fast-flights 不回傳單一航班的訂票 URL，只能組
  │            origin/dest/date 的搜尋頁連結——按鈕文案寫
  │            「在 Google Flights 查看」而非「訂票」，避免預期落差）
  ├─ 空結果 → 「查前一天／查後一天」快捷鈕
  └─ 失敗 → stale 快取（黃色警示）或錯誤畫面（重試鈕）
```

單頁式，條件同步 URL，可分享、可書籤。

### 4.3 線框

**桌機（≥1024px）**：

```
┌──────────────────────────────────────────────┐
│  ✈ FlightSearch                    [健康狀態燈]│ header 56px
├──────────────────────────────────────────────┤
│        ┌──── 搜尋卡片（居中 840px）──────────┐ │
│        │ [出發地 TPE▾] ⇄ [目的地 NRT▾]       │ │
│        │ [📅 2026-10-01] [👤1▾] [經濟艙▾]    │ │
│        │            [ 搜尋航班 ]              │ │
│        └─────────────────────────────────────┘ │
│  ▸ 價格趨勢（摺疊 → Recharts 折線圖）           │
│  排序：[最低價] [最短時間] [最早起飛]            │
│  資料來源：Google Flights・3 分鐘前              │
│  ┌────────────────────────────────────────┐   │
│  │ 🛫 EVA BR198  09:00 ─3h05m直飛─ 13:05   │   │
│  │                             NT$ 8,432 → │   │
│  └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**手機（375px）**：表單直排堆疊；卡片兩行制（航空公司＋時間軸／轉機資訊＋右對齊價格）；排序 tab 橫向可滑。

### 4.4 設計 Tokens

| Token | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#0B5FFF` | CTA、連結、選中態 |
| `--color-price` | `#0A7A3D` | 價格、最便宜徽章 |
| `--color-warning` | `#B45309` / bg `#FEF3C7` | stale 警示 |
| `--color-error` | `#DC2626` | 錯誤 |
| `--color-surface` | `#FFF` / bg `#F5F7FA` | 卡片／頁面 |
| 字體 | 系統字體棧（含 Noto Sans TC） | 免 webfont |
| 字級 | 價格 24 bold／標題 18／內文 14／輔助 12 | 手機最小 14px |
| 圓角陰影 | 卡片 12px、shadow-sm→hover md | 輕量層次 |
| 間距 | 4px 網格 | 一致節奏 |

### 4.5 互動狀態規格

| 狀態 | 規格 |
|---|---|
| Loading | 3 張骨架卡脈動；文案 2.5 秒輪播「正在比對航班…／查詢通常需要 5–8 秒／快好了…」 |
| 成功 | 卡片 stagger 淡入 50ms；最低價綠色「最便宜」徽章 |
| 空結果 | 插圖＋「這天沒有找到航班」＋查前/後一天快捷鈕 |
| Stale | 黃色警示列「⚠ 即時查詢暫時無法使用，以下為 XX 分鐘前的快取資料」＋重新嘗試 |
| 錯誤 | 「查詢失敗，請稍後再試」＋重試鈕；不漏狀態碼/traceback |
| 防抖 | 搜尋中 CTA disabled＋spinner |

### 4.6 無障礙與效能

鍵盤全可達＋focus ring；表單皆 label；圖表 aria-label 摘要；對比 ≥ AA；首屏 JS < 150KB gzip、LCP < 2.5s；Recharts dynamic import；不引 UI 庫與 webfont。

---

## 5. 穩定性保證方案

### 5.1 SLO

| 指標 | 目標 |
|---|---|
| 可用率 | ≥ 99%/月 |
| 快取命中 P95 | < 1 秒 |
| 未命中 P95 | < 8 秒 |
| 「有結果可看」率（含 stale） | ≥ 99.5% |

### 5.2 十道防線

| # | 防線 | 機制 |
|---|---|---|
| 1 | 快取吸收 | 45 分 TTL cache-aside |
| 2 | 排程保溫＋錯峰 | 每日抓追蹤航線（每條間隔 5–10 分鐘隨機錯開），熱門查詢常駐快取且不形成規律流量指紋 |
| 3 | 保守請求 | fast-flights Semaphore(1)＋請求間隔 3–6 秒隨機 jitter（§5.5） |
| 4 | 重試 | tenacity ×2 指數退避（僅 timeout/5xx） |
| 5 | 熔斷 | 連錯 3 次 OPEN 5 分 → HALF_OPEN 試探；狀態存 DB |
| 6 | 備援源 | Amadeus production（配額 90% 自動停用保護） |
| 7 | 緊急兜底 | SerpAPI 免費 100 次/月（選配，手動開關） |
| 8 | Stale 兜底 | 全失敗回過期快取＋標註 |
| 9 | API 防護 | Token + IP rate limit。誠實定位：token 編譯進前端 bundle 即等同公開，防的是「沒看過網站的路過掃描器」；對「看過網站的人」真正的配額保護是 rate limit（防線本體）＋Amadeus 90% 停用（防線 6） |
| 10 | 監控保活 | UptimeRobot 5 分鐘 health（內含 DB 查詢，兼防 Supabase Free 休眠） |

### 5.3 Runbook

| 症狀 | 判斷 | 處置 |
|---|---|---|
| fast_flights OPEN > 1 天 | Google 改版或 IP 被封 | 先搜 fast-flights GitHub Issues 區分「改版」或「封鎖」→ 改版：`pip install -U`；封鎖：執行 §5.5 節流模式＋換 IP；期間 Amadeus 暫代主源＋TTL 調 180 分省配額 |
| Amadeus 429 | 配額罄 | 確認保護已停用；等月初重置 |
| Supabase 連不上 | Free 休眠 | Dashboard resume；確認 health 的 DB 查詢保活正常 |
| 排程沒跑 | 容器重啟時點 | 查 Zeabur log；misfire_grace_time=3600＋每小時冪等補跑（Phase 3 §4）應已自癒，若仍缺日再查補跑 job 是否存活 |
| 變慢但可用 | 命中率降 | 查快取筆數與清理；TTL 45→90 |

### 5.4 每月 10 分鐘例行維護

- [ ] health 看 Amadeus 當月用量
- [ ] `pip list --outdated`（重點 fast-flights）
- [ ] Supabase 用量與 price_history 成長
- [ ] UptimeRobot 月報

### 5.5 零 Proxy 生存策略（$0，取代付費 proxy）

**核心認知**：proxy 要解決的問題只有一個——Zeabur 機房 IP 打 Google 太頻繁會被封。但「被封」在本架構中不是災難（四層降級鏈兜底），所以正確策略是**把被封的機率壓到極低＋被封後自動休養**，而不是花錢買 IP。三招如下：

**（v2.3 誠實補述）**：封鎖判定的主因是 **IP 信譽（datacenter ASN）**，其次才是請求節奏——Zeabur 出口 IP 屬雲機房段，Google 對這類 IP 本就敏感，jitter 偽裝的效果有其上限。因此本策略的正確解讀是「降低機率＋確保被封時使用者無感」，而非「保證不被封」。**心態上把 Amadeus 視為共同主源而非備援**：若實際運行中 fast-flights 可用率明顯低於預期，這是架構已預期的情境，不是故障。對應動作已內建——附錄 F 閘門盡早通過、Phase 3 即實測 production 真實報價品質。

**第一招：保守請求（平時就低調，已寫進 Phase 1/3 Prompt）**
- Semaphore(1) 單併發＋每請求前 3–6 秒隨機 jitter，流量形同單一人類使用者
- 每日排程各航線間隔 5–10 分鐘隨機錯開，不產生規律流量指紋
- 45 分鐘 TTL 快取＋排程保溫，實際打到 Google 的量：個人使用情境下**每日約 15–30 次**——這個量級被封機率極低

**第二招：節流模式（被封時自動休養）**
- fast_flights provider 偵測到「封鎖特徵」（連續 429、回應含 CAPTCHA/unusual traffic 字樣）時，除了觸發熔斷，額外將 `provider_status` 標記 `throttled`
- 節流期間（24 小時）：TTL 自動拉長至 180 分鐘、每日排程改為每 2 日、恢復後首日維持半量——讓 IP 自然冷卻，Google 的臨時封鎖通常數小時至一天內解除
- 期間 Amadeus 接手主源，使用者無感

**第三招：換 IP（$0 手動大招）**
- Zeabur 重新部署（Redeploy）容器通常會取得新的出口 IP——被硬封時到 Zeabur 後台按一次 Redeploy 即可，無狀態設計保證重啟零影響
- 驗證：Redeploy 前後各打一次 `curl https://api.ipify.org` 比對

**升級條件（唯一需要花錢的情境）**：三招輪番使用後，fast-flights 仍在 30 天內被封 3 次以上，才考慮開通 proxy 填入 `HTTPS_PROXY`。以個人使用量預估，**此情境預期不會發生**。

---

## 附錄 A：Supabase Schema（以各 Phase 實際產出為準）

```sql
create table search_cache (
  id bigint generated always as identity primary key,
  cache_key text unique not null,
  payload jsonb not null,
  source text not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);
create index idx_cache_key on search_cache (cache_key);
create index idx_cache_expires on search_cache (expires_at);

create table price_history (
  id bigint generated always as identity primary key,
  route text not null,
  date date not null,
  lowest_price_twd int not null,
  source text not null,
  recorded_at timestamptz default now()
);
create index idx_history_route_date on price_history (route, date);

create table tracked_routes (
  route text primary key,
  enabled boolean not null default true
);
insert into tracked_routes (route) values ('TPE-WAW'), ('TPE-NRT'), ('TPE-FUK');

create table provider_status (
  provider text primary key,
  state text not null default 'closed',
  failure_count int not null default 0,
  opened_at timestamptz,
  monthly_calls int not null default 0,
  month_key text,
  last_success_at timestamptz,
  throttled boolean not null default false,   -- §5.5 節流模式（Phase 3 §5b）
  throttled_until timestamptz                 -- 節流解除時間（UTC）
);
```

## 附錄 B：環境變數

| 變數 | 位置 | 說明 |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Zeabur | 僅後端 |
| `AMADEUS_API_KEY` / `AMADEUS_API_SECRET` | Zeabur | Self-Service |
| `AMADEUS_ENV` | Zeabur | Phase 1-2 用 test 驗流程，Phase 3 起 `production` |
| `AMADEUS_MONTHLY_QUOTA` | Zeabur | 依後台實際免費額度填 |
| `API_TOKEN` | Zeabur | 後端驗證用 |
| `CACHE_TTL_MINUTES` | Zeabur | 預設 45 |
| `CACHE_TTL_THROTTLED_MINUTES` | Zeabur | 節流模式快取 TTL，預設 180 |
| `THROTTLE_HOURS` | Zeabur | 封鎖訊號後自動節流時長，到期自動恢復，預設 24 |
| `CB_COOLDOWN_SECONDS` | Zeabur | 預設 300 |
| `HTTPS_PROXY` | Zeabur | 純選配鉤子，預設留空（§5.5 三招無效才考慮） |
| `THROTTLE_MODE` | Zeabur | `on` 時啟動節流模式（§5.5），預設 off |
| `FX_USD_TWD` | Zeabur | 幣別兜底匯率 |
| `ALLOWED_ORIGINS` | Zeabur | Pages 網域 |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_TOKEN` | Cloudflare Pages | 前端（build 時打包，改值需重 build） |

> 完整說明與部署順序見 repo 根目錄 `DEPLOYMENT.md`；範本見 `backend/.env.example`、`frontend/.env.example`。

## 附錄 C：時程

| Phase | 內容 | 工時 |
|---|---|---|
| 0 | 環境（含 Amadeus production 申請） | 1h |
| 1 | 雙 provider＋切換鏈 | 1 天 |
| 2 | 快取＋歷史＋stale | 0.5 天 |
| 3 | 熔斷＋配額＋防護＋排程 | 1 天 |
| 4 | 前端 | 1–1.5 天 |
| 5 | 部署＋E2E＋驗收 | 0.5–1 天 |
| **合計** | | **約 4–5 個工作天**（開發工時；結案另需 +7 個日曆日的可用率觀察期，見成功標準最後一條） |

## 附錄 D：AI 卡關處理 SOP

**三次法則**：同一 bug 讓 AI 修 3 次未果 → 立即停手，依序執行：

1. **回滾**：`git reset --hard phase-N-done`（查核點＝存檔點），評估是否重來比硬修快。**⚠ 注意**：git 回滾只回滾程式碼，**Supabase schema 不會跟著回滾**——Phase 2 之後若跨 Phase 回滾，先確認舊程式碼與現行 schema 相容（本計畫 schema 只增不改，通常相容，但仍須確認）
2. **開新 session**：只帶「最小重現」——這段 code＋這個輸入＋預期 X＋實際 Y＋完整錯誤訊息。**不帶失敗史**（context 污染是繞圈主因）
3. **換工具交叉**：Claude Code 卡住丟 Codex，反之亦然
4. **先問診再開刀**：加一句「先解釋 root cause，我同意分析後才能改 code」
5. **測試逼供**：「先寫一個會失敗的測試重現 bug，再修到通過」——AI 會說已修復，測試不會說謊
6. **餵事實**：要求加 logging 印出真實資料（API 原始回應、變數值）貼回去；AI 不擅長猜資料長相，擅長看著真資料寫轉換
7. **第三方庫壞掉先搜 GitHub Issues**：fast-flights 斷線八成是上游改版，答案在 issue 串，不在 AI 推理裡；把討論串貼給 AI 再修

---

*正文結束（現行版本 v2.4）。各 Phase 查核點通過後於本文件打勾並 git tag，作為專案完成紀錄。*

## 附錄 E：熔斷器審定規格（Fable 審定版，實作唯一依據）

> 使用方式：Phase 3 執行時，本附錄全文連同 Prompt 貼給 Claude Code。
> AI 不得變更本規格；完成後必須交付 E1–E10 逐條「規格對照表」。

**E1. 狀態機（唯一合法轉換）**

```
CLOSED ──連續失敗達 3 次──▶ OPEN
OPEN ──冷卻期滿（CB_COOLDOWN_SECONDS）──▶ HALF_OPEN
HALF_OPEN ──試探成功──▶ CLOSED（failure_count 歸零）
HALF_OPEN ──試探失敗──▶ OPEN（重新起算冷卻）
CLOSED 內任一次成功 ──▶ failure_count 歸零
```
除上列五條外不存在其他轉換。

**E2. 失敗的定義**：`provider.search()` 拋出例外或逾時，才計為一次失敗。參數驗證錯誤（422 類）發生在進 provider 之前，**不計入**——那是使用者的錯，不是資料源的錯。

**E3. 重試與熔斷的關係**：tenacity 重試發生在 provider 內部；對熔斷器而言，一次 `search()` 呼叫 = 一個成功/失敗事件。內部重試 2 次全敗只記 1 次失敗，不得重複計數。

**E4. HALF_OPEN 併發控制**：試探請求全域同時只允許 1 個，以 `asyncio.Lock` 實作。試探進行中湧入的其他請求**不等待、不試探**，直接路由至下一個 provider（Amadeus）。

**E5. 適用範圍**：熔斷器類別寫成通用（以 provider 名稱為 key），但**只掛在 fast_flights 上**。Amadeus 由配額保護機制管理，不掛熔斷——兩套機制不可混用同一計數器。

**E6. 持久化策略（DB 是復原輔助，不是依賴）**：
- 每次狀態轉換即寫 `provider_status`；**寫入失敗時 log warning 後繼續以記憶體狀態運作**，絕不因 Supabase 故障而讓熔斷器本身故障
- 啟動時自 DB 載入：若 `state=open` 且 `opened_at + cooldown` 已過 → 直接以 HALF_OPEN 啟動；未過 → 以 OPEN 啟動並沿用原 `opened_at`
- 所有時間戳一律 UTC

**E7. provider_status schema**（Phase 3 的 db/schema_v2.sql 即此表，與附錄 A 一致）：`provider (pk), state, failure_count, opened_at, monthly_calls, month_key, last_success_at, throttled, throttled_until`（末兩欄屬 §5.5 節流模式，非熔斷狀態機的一部分，熔斷器不得讀寫它們）

**E8. 配額計數的月輪替**：每次 Amadeus 呼叫前比對 `month_key` 與當前 `YYYY-MM`（UTC），不一致即歸零 `monthly_calls` 並更新 `month_key`。達 `AMADEUS_MONTHLY_QUOTA × 0.9` 即停用 Amadeus 並於 health 標示 warning。

**E9. 可觀測性**：每次狀態轉換 log 一行結構化訊息：`provider / from_state / to_state / failure_count / reason`。`/api/health` 必須即時反映 E1 的當前狀態。

**E10. 必備測試（缺一即未完成）**：
1. 連續 3 次失敗 → OPEN；第 2 次失敗後成功 → 計數歸零不 OPEN
2. OPEN 期間請求不觸碰 fast_flights（以 mock 呼叫次數斷言）
3. 冷卻期滿 → HALF_OPEN 試探成功 → CLOSED / 失敗 → OPEN
4. HALF_OPEN 併發：10 個併發請求只有 1 個打到試探、其餘走 Amadeus
5. DB 寫入失敗時熔斷器仍正常轉換（mock supabase 拋錯）
6. 重啟還原：DB 存 OPEN 且冷卻已過 → 啟動即 HALF_OPEN
7. 月輪替歸零；配額 90% 停用

---

## 附錄 F：Amadeus Production 切換閘門（機械化規則）

> 目的：把「production 審核何時通過」從判斷題變成是非題。閘門只有一條指令、兩種結果、零裁量空間。

**F1. 閘門判定指令**（打的是正式環境 `api.amadeus.com`，不是 `test.api.amadeus.com`）：

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://api.amadeus.com/v1/security/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$PROD_KEY&client_secret=$PROD_SECRET"
```

**F2. 判定規則（無例外）**：

| 回傳 | 判定 | 動作 |
|---|---|---|
| `200` | 閘門通過 | 立即設 `AMADEUS_ENV=production`，執行 Phase 3 真實報價查核點 |
| 其他任何值 | 閘門未過 | Phase 3 該項標「遞延」，**照常進入 Phase 4**（前端不依賴 Amadeus）；每 2 個日曆日重跑 F1 一次，直到通過 |

**F3. 結案封鎖條款**：Phase 5 最終驗收含一條硬性項目——「F1 已回傳 200、`AMADEUS_ENV=production`、線上熔斷演練切換到的是真實報價」。此項未過，其餘全綠也不得 `git tag v1.0.0`。也就是說：審核延遲最多拖慢結案日，**永遠不會讓 test 假資料混進正式驗收**——這正是 v2.0 指出的錯誤信心陷阱，v2.1 用封鎖條款把它焊死。

**F4. 逾期升級**：若閘門連續 14 天未過，改為人工介入單一動作——到 Amadeus 後台查看申請狀態並補件。這是全計畫唯一可能需要人出手的殘餘點，且動作明確。

---

## 附錄 G：情境風險清單（v2.4 Fable 推演版）

> 推演方法：假想系統上線運行 30 天，逐層問「這裡會怎麼出事」。
> 每條含：情境 → 後果 → 解法 → 落點（已修入哪個 Phase Prompt，或屬 Runbook/認知項）。
> G1–G4 是本輪發現的**規格級問題**（不修就會上線出事），G5 起為次級風險與認知校準。

### 🔴 規格級（已修入對應 Prompt）

**G1. price_history 被非基準查詢污染**
- 情境：使用者查一次 TPE-NRT 商務艙 2 人 → Phase 2 原規格「每次成功搜尋 upsert 當日最低價」把商務艙價寫進趨勢。
- 後果：趨勢圖出現無法解釋的尖峰，價格歷史（本案核心價值之一）失真且不可逆。
- 解法：只有 `adults=1 & cabin=economy` 的查詢寫 history；其他查詢照常回結果但不落歷史。
- 落點：已修入 Phase 2 Prompt【history 基準鐵則】。

**G2. 空結果被誤判為失敗**
- 情境：查冷門航線，fast-flights 正常回應但 0 筆航班。若切換鏈把「空」當「敗」→ 每次都 failover 到 Amadeus；連查 3 次還會誤觸熔斷 OPEN。
- 後果：白燒 Amadeus 配額＋熔斷器記錄假失敗，health 顯示假故障。
- 解法：空結果 = 成功，直接回傳（前端本就有查前後日 UI）；只有例外/逾時才是失敗（與附錄 E §E2 一致）。
- 落點：已修入 Phase 2 Prompt【空結果語意】。

**G3. Amadeus 配額計數的 crash 窗口**
- 情境：後端打完 Amadeus、寫 monthly_calls +1 之前容器重啟 → 漏計。長期累積 + 90% 閾值形同虛設，而 production 已綁帳單，超額是**真實費用**。
- 解法：先 +1 落庫、再發請求——寧可多計不可少計。DB 寫入失敗時本次直接跳過 Amadeus（fail-closed，回 stale 也不冒扣款風險）。
- 落點：已修入 Phase 3 Prompt【計數順序鐵則】。

**G4. 驗收與 E2E 流量自傷**
- 情境：Phase 5 每輪 E2E、Lighthouse 重跑、以及你自己的反覆手動驗收，全部打真實 fast-flights → 開發驗收期的請求密度遠高於日常，**最可能被封鎖的時刻正是驗收當天**。
- 解法：E2E 固定查「排程已抓過的追蹤航線＋日期」讓流量落在快取層；手動驗收也優先用同一組條件；真要驗即時查詢，一天內限少數幾次。
- 落點：已修入 Phase 5 步驟 4【E2E 流量自律】。

### 🟡 設計澄清（已修入 Prompt 或線框）

**G5. 「深層連結」實際上做不到**
fast-flights 不回傳單一航班的訂票 URL，能組的只有 origin/dest/date 的 Google Flights 搜尋頁連結。已修正 4.2 使用者流程：按鈕語意改「在 Google Flights 查看」，避免使用者預期「點了直接訂這班」的落差。Amadeus 結果同理——`booking_hint` 只給航空公司名，連結仍指 Google Flights 搜尋頁。

**G6. 跨源價格趨勢跳動**
Google 與 Amadeus 的報價基準不同（Amadeus 常見「from」價、LCC 覆蓋較弱），fast-flights 被熔斷期間的 history 點位會系統性偏移，趨勢圖出現階梯。解法：history 已記 source（schema 本有），前端趨勢圖以顏色/點型區分 source，讓跳動「可解釋」即可——個人專案不必做跨源校準。

**G7. Amadeus 結果「看起來變貴」不是 bug**
TPE-NRT/FUK 是 LCC 重鎮（樂桃、虎航、酷航），Amadeus Self-Service 對 LCC 覆蓋有限。熔斷切換後最低價可能顯著上升——這是資料源特性，不是程式錯誤。認知項：寫進 Runbook 心智，前端資料源標註列（4.3 已有）就是為此存在。

### 🟢 次級風險（Runbook / 認知項，不改 Prompt）

**G8. 前後端契約漂移（雙 AI 工具開發）**：Phase 3 完成後把 FastAPI 自動生成的 `/openapi.json` 存進 repo（`/docs/openapi.json`），Phase 4 Prompt 連同 UX 文件一起餵給前端 AI 當唯一契約；後端改介面必須重新輸出此檔。成本一分鐘，防掉「前端猜欄位名」整類 bug。

**G9. slowapi 在反向代理後的 IP 判定**：Zeabur 前有代理時，取 `request.client.host` 可能全是代理 IP（所有人共用一個 bucket、你自己把自己 429），改信 `X-Forwarded-For` 又可偽造。個人專案解法：取 XFF 最左值即可，接受可偽造——rate limit 的真正底線是 Amadeus 90% 停用（防線 6），不是這裡。Phase 5 部署後實測一次：從兩個不同網路打，確認 429 是分開計的。

**G10. `NEXT_PUBLIC_*` 是建置期烘焙**：換 API token 不是改 Cloudflare Pages 環境變數就生效——必須觸發前端重新 build。Runbook 認知項：輪替 token 的正確順序 = 後端先「同時接受新舊」→ 前端重建 → 後端撤舊。個人專案可簡化為「換 token 時接受幾分鐘中斷」，但要知道有這回事。

**G11. mock 測試與上游現實漂移**：pytest 全 mock，fast-flights 上游改版後測試照樣全綠。解法：加一支 `scripts/live_smoke.py`（真打一次 TPE-NRT、驗欄位齊全），**不進 CI**，每月維護（§5.4）時手動跑，兼作 fast-flights 健康檢查。

**G12. 公開 health 的資訊洩漏**：`/api/health` 免 token，卻要顯示熔斷狀態、配額用量、throttled——這些是內部運營資訊。個人專案風險低，但舉手之勞：公開版只回 `{"status":"ok","db":true}`（夠 UptimeRobot 用），帶 token 才回完整 provider 細節。Phase 3 實作時順手做。

**G13. fast-flights 價格是字串**：上游回傳如 `"NT$8,432"` 的顯示字串，需解析出數值＋從符號推斷幣別。解析失敗（新幣別符號、格式變動）應讓該筆航班標記 price=null 進 log，而非整個查詢拋例外觸發熔斷——單筆解析失敗不是資料源失敗。Phase 1 實作時的防禦性細節。

**G14. 快取擊穿（同 key 併發 miss）**：兩個分頁同時查同一條件都未命中 → 都打 provider。Semaphore(1) 已讓後者排隊，等到時前者多半已寫入快取，但仍會多打一次。個人使用量下**接受即可**，不值得為此加 per-key lock；若日後多人使用再處理。

### 推演後的總體判斷

架構本體（四層鏈＋熔斷＋stale）經得起推演，沒有需要重新設計的部分。本輪修正全是「規格邊界」問題——空結果、非基準查詢、計數時序、驗收流量——共同特徵是**單元測試測不出來、要靠情境推演或上線才會暴露**。G1–G4 修入 Prompt 後，剩餘項目按落點處理即可，不影響 4–5 天工時估計。

---

*v2.1 修訂：原兩個人工把關點已分別由附錄 E（預審定規格）與附錄 F（機械化閘門）取代。*
*v2.2 修訂：proxy 降為純選配，新增 §5.5 零 Proxy 生存策略。*
*v2.3 修訂（技術審查）：修訂總覽 #14–#18——async 阻塞防呆、schema 一致化、排程冪等補跑、health 保活實測、防線措辭校準與 IP 風險誠實補述。附錄 E/F 規格本體不變。*
*v2.4 修訂（情境推演）：修訂總覽 #19–#20——新增附錄 G 十四條情境風險，G1–G4 規格級問題已修入 Phase 2/3/5 Prompt 與 4.2 流程。附錄 E/F 規格本體不變。*
