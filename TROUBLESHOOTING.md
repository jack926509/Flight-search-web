# 異常狀況處理手冊

> 涵蓋本系統所有已知異常狀況：症狀 → 原因 → 系統自動行為 → 你需要做什麼。
> 快速診斷指令見文末附錄。

---

## A. 使用者畫面上的異常

### A1. 右上角系統狀態燈

| 燈號 | 含義 | 需要做什麼 |
|---|---|---|
| 🟢 正常 | 後端可達、資料庫正常 | — |
| 🟡 部分異常 | 後端可達，但**資料庫離線**：快取與價格歷史暫停，即時查詢仍可用 | 見 [D1](#d1-健康檢查-db-false) |
| 🔴 異常 | 後端完全無回應，或上次查詢失敗 | 見 [E3](#e3-後端服務無回應) |

狀態燈每 60 秒自動打一次 `/api/health` 更新，滑鼠停留可看提示文字。

### A2. 「查詢失敗」畫面的各種訊息

| 訊息 | 原因 | 解決方法 |
|---|---|---|
| 連線逾時：伺服器可能正在忙碌或喚醒中 | 後端處理超過 45 秒（fast-flights 慢或服務剛喚醒） | 按「重試」。連續逾時見 [E3](#e3-後端服務無回應) |
| 無法連線到伺服器 | 斷網、後端掛掉、或 CORS 設定錯誤 | 確認自己網路 → 仍失敗則看瀏覽器 Console：出現 `blocked by CORS policy` 見 [E1](#e1-cors-錯誤)；否則見 [E3](#e3-後端服務無回應) |
| 授權失敗：前端 API Token 與後端不符 | Cloudflare Pages Function 的 `FLIGHT_SEARCH_API_TOKEN` ≠ 後端 `API_TOKEN`；或本機開發時 `NEXT_PUBLIC_API_TOKEN` 不符 | production 核對 Cloudflare `FLIGHT_SEARCH_API_TOKEN`；本機才核對 `NEXT_PUBLIC_API_TOKEN` |
| 查詢太頻繁，請等 1 分鐘後再試 | 觸發後端 rate limit（同 IP 每分鐘 20 次） | 等 1 分鐘。正常使用不會觸發；持續出現代表有掃描流量，屬防護正常運作 |
| 查詢條件有誤 | 機場代碼非 3 大寫字母、日期格式錯或是過去日期、艙等不合法 | 依訊息括號內的細節修正輸入 |
| 兩個航班資料來源暫時都無法使用 | fast-flights 與 Kiwi 同時失敗且無可用快取 | 稍後重試——熔斷器冷卻 5 分鐘後自動試探恢復。持續 30 分鐘以上見 [C 節](#c-資料來源provider層異常) |

### A3. 黃色警示條「即時查詢暫時無法使用，以下為 X 前的快取資料」

- **原因**：兩個資料來源都失敗，系統自動退回過期快取（stale 兜底）。
- **系統自動行為**：資料照常顯示、標註快取時間；熔斷器會在冷卻後自動試探恢復。
- **你需要做什麼**：價格僅供參考，訂票前按「重新嘗試」拿即時價。頻繁出現見 [C 節](#c-資料來源provider層異常)。

### A4. 「這天沒有找到航班」

- **原因**：該航線該日確實無直達／可售航班（此為正常結果，非故障）。
- **解決方法**：用「← 查前一天／查後一天 →」快捷鈕換日期，或改查鄰近機場（如 NRT ⇄ HND）。

### A5. 多段行程（外站・四腿）某段沒有報價

- **顯示**：總價列出現「尚有 N 段無報價（查詢中／失敗／無航班），未計入總價」。
- **原因**：多段模式各段為獨立查詢，單段失敗不影響其他段。
- **解決方法**：該段顯示「重試此段」按鈕，單獨重查即可；若該段為「這天沒有找到航班」，換日期或鄰近機場。總價只加總已有報價且已選擇的段。

### A6. 外站組合比價矩陣的特殊格子

| 格子 | 含義 | 解決方法 |
|---|---|---|
| `—` | 段2日期早於段1，組合不可行 | 正常標記，不用處理 |
| `無班` | 該日期查無航班 | 換日期範圍或鄰近機場 |
| `✕` | 該日期查詢失敗 | 按「開始組合比價」重跑——已查過的日期會吃快取（<1s），只有失敗的日期會真正重查 |
| 一直是 `…` | 查詢仍在進行（並發 2 佇列，未快取時整輪約 1–3 分鐘） | 看進度列「已完成 X / Y」；卡住超過 5 分鐘代表後端異常，見 [E3](#e3-後端服務無回應) |

### A7. 價格趨勢顯示「累積中」

- **原因**：該航線歷史資料不足 3 筆。排程每天 09:00（台北時間）自動抓 3 條種子航線；其他航線靠使用者查詢時累積（僅 1 人＋經濟艙的查詢會寫入，G1 基準鐵則）。
- **解決方法**：不用處理，等資料累積。若隔了多天仍是 0 筆，見 [D2](#d2-排程沒有寫入價格歷史)。

---

## B. HTTP 錯誤碼對照（curl／監控告警時）

| 狀態碼 | 端點 | 含義 | 處理 |
|---|---|---|---|
| 403 `FORBIDDEN` | `/api/search`、`/api/history` | 缺 `X-API-Token` 或不符 | 正常防護（擋掃描）。自己的請求被擋→核對 Token |
| 422 | `/api/search`、`/api/history` | 參數驗證失敗 | 依 `detail` 修正參數 |
| 429 | 全部 | rate limit（20/min/IP） | 等 1 分鐘；監控頻率請勿高於每分鐘數次 |
| 500 `INTERNAL_ERROR` | 全部 | 未預期錯誤（訊息不外洩細節） | 看 Zeabur log 的 exception stack；回報 issue |
| 503 `ALL_PROVIDERS_FAILED` | `/api/search` | 兩資料源都掛且無 stale 快取 | 見 [C 節](#c-資料來源provider層異常) |
| 503 `Database not configured` | `/api/history` | 後端沒設 `SUPABASE_URL` | 補環境變數後重啟 |

---

## C. 資料來源（Provider 層）異常

### C1. fast-flights 被 Google 節流（主資料源）

- **症狀**：`/api/health` 的 `providers.fast_flights.throttled` 為 `true`；搜尋結果 `source` 變成 `kiwi`；log 出現 `captcha` / `unusual traffic` / `too many requests`。
- **系統自動行為**（無需人工介入）：
  1. 立即標記節流，**24 小時後自動恢復**（`THROTTLE_HOURS`，重啟也會從 DB 還原狀態）
  2. 快取 TTL 自動從 45 分鐘拉長到 180 分鐘（降低對 Google 的請求量）
  3. 查詢自動切到 Kiwi.com 備援
- **手動處置**：通常不用。若要立刻強制節流模式（例如預期性防禦），設 `THROTTLE_MODE=on` 重啟；解除改回 `off`。

### C2. Kiwi 月配額用盡（備援資料源）

- **症狀**：log 出現 `kiwi quota soft limit reached (2700/2700)`；fast-flights 也掛時查詢回 503 或 stale。
- **系統自動行為**：達每月上限 90%（預設 3000×0.9=2700 次）即自停，**下月 1 日自動重新計數**。
- **手動處置**：Kiwi MCP 為免費公開端點，配額是自律值（G3/G4 流量禮貌）。確有需要可調高 `KIWI_MONTHLY_QUOTA` 後重啟，但請節制。

### C3. 熔斷器（circuit breaker）打開

- **症狀**：`/api/health` 的 `circuit_breakers.<provider>` 顯示 `open`。
- **機制**：連續失敗 3 次 → `open`（跳過該資料源）→ 冷卻 300 秒（`CB_COOLDOWN_SECONDS`）→ `half_open` 放一個試探請求 → 成功回 `closed`、失敗重新冷卻。**全自動，重啟後狀態從 DB 還原。**
- **手動處置**：不用干預。若某資料源 `open` 超過 1 小時，代表它持續故障——看 Zeabur log 找根因（Google 封鎖？Kiwi 端點改版？）。

### C4. 兩個資料源同時故障

- **系統自動行為**：先退 stale 快取（前端顯示黃色警示條）；連 stale 都沒有才回 503。
- **手動處置**：`curl` 分別驗證兩邊（見附錄），確認是對方服務問題還是自己網路／部署問題。Kiwi 官方端點故障可等待或到 [Kiwi MCP](https://mcp.kiwi.com/) 確認狀態。

---

## D. 資料庫與排程異常

### D1. 健康檢查 `db: false`

- **症狀**：`/api/health` 回 `"db": false`；前端狀態燈轉黃「部分異常」。
- **影響**：快取、價格歷史、熔斷器持久化、Kiwi 配額計數全部暫停；**即時查詢仍可用**（退化為 Phase 1 直查模式）。
- **依序排查**：
  1. **Supabase 免費版閒置暫停**（最常見）：專案 7 天無流量會自動 pause → [Dashboard](https://supabase.com/dashboard/project/abbjtfnbzxwxkrurijvl) 按 Restore。UptimeRobot 5 分鐘打一次 health（內含 DB ping）即可避免再發生
  2. `SUPABASE_URL` 或 `SUPABASE_SERVICE_KEY` 填錯／過期 → 核對 Zeabur 環境變數（key 要用 **service_role**，不是 anon）
  3. Supabase 平台故障 → [status.supabase.com](https://status.supabase.com)

### D2. 排程沒有寫入價格歷史

- **症狀**：隔天 `price_history` 表沒有新增 3 條種子航線的資料。
- **依序排查**：
  1. Zeabur log 搜 `scheduler`——啟動時應有排程註冊訊息，09:00（Asia/Taipei）應有執行紀錄
  2. 服務在 09:00 時是否活著？Zeabur 免費方案會休眠 → 排程有 `misfire_grace_time=3600`，喚醒後 1 小時內會補跑；超過就等隔天（冪等設計，不會重複寫入）
  3. `db: false`（見 D1）——DB 掛了排程寫不進去

### D3. 快取好像沒生效（每次查都很慢）

- **判斷**：連續查同條件兩次，第二次 `source` 應為 `cache` 且 <1 秒。
- **原因**：查詢五元組（出發地/目的地/日期/人數/艙等）任一不同就是不同 cache key；TTL 過期（45 分鐘）；或 `db: false`。

---

## E. 部署層異常

### E1. CORS 錯誤

- **症狀**：瀏覽器 Console 出現 `blocked by CORS policy`，畫面顯示「無法連線到伺服器」。
- **解決方法**：Zeabur 的 `ALLOWED_ORIGINS` 必須**完全等於** Pages 網域——含 `https://` 前綴、無結尾斜線，例：`https://flight-search.pages.dev`。多網域用逗號分隔。改完重啟後端。
- 註：OPTIONS preflight 已豁免 token 檢查（2026-07-07 修復），若你 fork 舊版程式碼請確認 `main.py` 的 token middleware 有 `if request.method == "OPTIONS"` 放行。

### E2. 改了環境變數但前端行為沒變

- **原因**：`NEXT_PUBLIC_*` 在 **build 時固化進 JS**；`FLIGHT_SEARCH_*` 是 Pages Function 伺服器端變數。
- **解決方法**：改 `NEXT_PUBLIC_*` 必須重新 build；改 `FLIGHT_SEARCH_API_URL` / `FLIGHT_SEARCH_API_TOKEN` 後重新部署 Pages Function。production 正常情況下不需要 `NEXT_PUBLIC_API_TOKEN`。

### E3. 後端服務無回應

- **依序排查**：
  1. `curl https://<zeabur-domain>/api/health` —— 有回應代表只是前端連線問題（回 [E1](#e1-cors-錯誤)）
  2. Zeabur Dashboard 看服務狀態與 log：OOM／crash loop → 看 stack trace；剛部署失敗 → 看 build log
  3. 免費方案冷啟動：閒置後第一個請求會慢（喚醒），前端 45 秒逾時內通常來得及；UptimeRobot 保活可避免
  4. Zeabur 平台故障 → [status.zeabur.com](https://status.zeabur.com)

### E4. UptimeRobot 告警處置流程

1. 開 `/api/health` 手動確認（可能只是單次網路抖動）
2. 完全無回應 → [E3](#e3-後端服務無回應)；回 200 但 `db: false` → [D1](#d1-健康檢查-db-false)
3. 恢復後確認前端搜尋一次成功即結案

### E5. Cloudflare Pages `/api/*` proxy 異常

- **症狀**：前端同網域 `/api/search` 回 `PROXY_NOT_CONFIGURED` 或 500。
- **原因**：Cloudflare Pages Function 缺 `FLIGHT_SEARCH_API_TOKEN`，或 token 與 Zeabur 後端不一致。
- **解決方法**：Cloudflare Pages → Settings → Environment variables 設：
  - `FLIGHT_SEARCH_API_URL=https://flight-search-api.zeabur.app`
  - `FLIGHT_SEARCH_API_TOKEN=<與 Zeabur API_TOKEN 相同>`
  設完後重新部署 Pages。

---

## 附錄：快速診斷指令

```bash
BACKEND=https://<zeabur-domain>
FRONTEND=https://<pages-domain>
TOKEN=<你的 API_TOKEN>

# 1. 後端活著嗎？DB 正常嗎？熔斷器狀態？（免 token）
curl -s $BACKEND/api/health | python3 -m json.tool

# 2. 完整搜尋鏈路（含 token）——看 source 判斷走了哪個資料源
curl -s -H "X-API-Token: $TOKEN" \
  "$BACKEND/api/search?origin=TPE&dest=NRT&date=$(date -d tomorrow +%F)" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('source:', d['source'], '| flights:', len(d['flights']), '| stale:', d.get('stale'))"

# 3. CORS preflight 是否放行（模擬瀏覽器）——應回 200 且帶 access-control-allow-origin
curl -si -X OPTIONS -H "Origin: https://<pages-domain>" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-api-token" \
  "$BACKEND/api/search" | head -12

# 4. Cloudflare Pages proxy 是否正常（production 前端應打同網域 /api，瀏覽器不再持有 token）
curl -s "$FRONTEND/api/health" | python3 -m json.tool
```

`/api/health` 回應範例與判讀：

```json
{
  "status": "ok",
  "db": true,                      // false → D1；null → 未設 DB（Phase 1 模式）
  "providers": {
    "fast_flights": { "reachable": true, "throttled": false },  // throttled:true → C1
    "kiwi": { "reachable": true }
  },
  "circuit_breakers": {
    "fast_flights": "closed",      // open → C3（自動恢復中）
    "kiwi": "closed"
  }
}
```
