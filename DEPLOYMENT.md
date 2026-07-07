# 部署環境變數規劃

> 單一事實來源：`backend/.env.example`（後端）與 `frontend/.env.example`（前端）。
> 本文件是部署時的操作對照表。真實金鑰只存在 Zeabur / Cloudflare Pages 後台與密碼管理器，絕不進 repo。
> 部署後遇到任何異常 → 見 **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**（症狀 → 原因 → 解決方法）。

## 1. Zeabur（後端 `/backend`）

依序在 Zeabur → Service → Environment Variables 設定：

### 必填

| 變數 | 來源／產生方式 | 範例值 |
|---|---|---|
| `SUPABASE_URL` | 已建：專案 `flight-search` | `https://abbjtfnbzxwxkrurijvl.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API，取 **service_role** key（不是 anon） | `eyJ...` |
| `API_TOKEN` | `openssl rand -hex 24` | — |
| `ALLOWED_ORIGINS` | Cloudflare Pages 部署後的網域 | `https://xxx.pages.dev` |

### 選填（有預設值，通常不用設）

| 變數 | 預設 | 說明 |
|---|---|---|
| `CACHE_TTL_MINUTES` | `45` | 一般快取 TTL |
| `CACHE_TTL_THROTTLED_MINUTES` | `180` | 節流模式快取 TTL |
| `THROTTLE_HOURS` | `24` | 封鎖訊號後自動節流時長，到期自動恢復 |
| `THROTTLE_MODE` | `off` | `on` = 手動強制節流（§5.5 應急開關） |
| `CB_COOLDOWN_SECONDS` | `300` | 熔斷器 OPEN→HALF_OPEN 冷卻 |
| `KIWI_MCP_URL` | `https://mcp.kiwi.com/` | Kiwi.com 官方公開 MCP 端點（免金鑰） |
| `KIWI_MONTHLY_QUOTA` | `3000` | Kiwi 每月自律上限（G4），達 90% 自動停用 |
| `FX_USD_TWD` | `32.0` | 備援 provider 回 USD 時的兜底匯率 |
| `HTTPS_PROXY` | 空 | 純選配鉤子（§5.5 三招無效才考慮） |

## 2. Cloudflare Pages（前端 `/frontend`）

Build command：`npm run build`　Output directory：`out`

| 變數 | 值 | 注意 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Zeabur 後端網域（結尾不加 `/`） | build 時打包進 JS |
| `NEXT_PUBLIC_API_TOKEN` | 與後端 `API_TOKEN` 相同 | ⚠ 靜態輸出＝公開可見，僅擋無腦掃描；真正防護靠後端 rate limit + CORS |

改任何 `NEXT_PUBLIC_*` 變數後必須 **重新 build**（靜態輸出，變數在 build 時固化）。

## 3. 本機開發 / E2E（不進任何後台）

| 變數 | 用途 |
|---|---|
| `E2E_BASE_URL` | Playwright 目標網址（預設 `http://localhost:3000`） |
| `E2E_CACHED_DATE` | 排程已抓過的日期（YYYY-MM-DD），讓 E2E 打快取不打真實資料源（G4） |

## 4. 部署順序（變數相依關係）

1. ~~Supabase 建專案 → 執行 schema~~ ✅ 已完成（`schema.sql` + `schema_v2.sql` + `schema_v3.sql` 已套用、RLS 已啟用）→ 只剩取得 service_role key
2. `openssl rand -hex 24` 產生 `API_TOKEN`
3. Zeabur 部署後端（先填上述變數，`ALLOWED_ORIGINS` 暫填 `http://localhost:3000`）
4. Cloudflare Pages 部署前端（`NEXT_PUBLIC_API_URL` 填 Zeabur 網域）
5. 回 Zeabur 把 `ALLOWED_ORIGINS` 改成 Pages 網域 → 重啟
6. UptimeRobot 打 `https://<zeabur-domain>/api/health`（5 分鐘）
