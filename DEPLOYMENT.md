# 部署環境變數規劃

> 單一事實來源：`backend/.env.example`（後端）與 `frontend/.env.example`（前端）。
> 本文件是部署時的操作對照表。真實金鑰只存在 Zeabur / Cloudflare Pages 後台與密碼管理器，絕不進 repo。
> 部署後遇到任何異常 → 見 **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**（症狀 → 原因 → 解決方法）。

## 1. Zeabur（後端 `/backend`）

目前後端：

- Project：`untitled`（ID `6a4c6b637e05aa801c1ab360`）
- Service：`flight-search-api`（ID `6a4d0ef2c2881a93656dfc46`）
- URL：`https://flight-search-api.zeabur.app`
- 最新 deployment：`6a4e5bfdd5520eae64fa38dc`
- 已驗證（2026-07-08）：`/api/health` 回 200，`db: true`，`fast_flights` / `kiwi` 均 reachable；direct API 與 Cloudflare proxy 皆有安全標頭。

> 注意：Zeabur 另有舊服務 `flight-search-web`（ID `6a4c6b717e05aa801c1ab366`）。該服務可能被 Git 自動部署成 static，不作為正式 API 來源。

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

目前前端：

- Project：`flight-search-web`
- Production URL：`https://flight-search-web-29x.pages.dev`
- 最新部署：`https://01e99737.flight-search-web-29x.pages.dev`
- 正式部署方式：Cloudflare Pages 內建 GitHub integration，從 `jack926509/Flight-search-web` 的 `main` 分支自動建置
- GitHub 部署整理：見 [`CLOUDFLARE_GITHUB_DEPLOYMENT.md`](CLOUDFLARE_GITHUB_DEPLOYMENT.md)

Cloudflare Pages GitHub build 設定：

| 欄位 | 值 |
|---|---|
| Production branch | `main` |
| Git repository | `jack926509/Flight-search-web` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `out` |

Cloudflare Pages production 環境變數：

| 變數 | 值 | 注意 |
|---|---|---|
| `FLIGHT_SEARCH_API_URL` | `https://flight-search-api.zeabur.app` | Pages Function 伺服器端變數，不會打包進 JS |
| `FLIGHT_SEARCH_API_TOKEN` | 與 Zeabur 後端 `API_TOKEN` 相同 | Pages Function 伺服器端變數，不會公開到瀏覽器 |
| `NEXT_PUBLIC_API_URL` | 留空 | production 走同網域 `/api/*` proxy |
| `NEXT_PUBLIC_API_TOKEN` | 留空 | 不再把 token 打包進瀏覽器 JS |

本機開發可在 `frontend/.env.local` 設 `NEXT_PUBLIC_API_URL=http://localhost:8000` 直連本機後端。
改 `NEXT_PUBLIC_*` 變數後必須 **重新 build**（靜態輸出，變數在 build 時固化）；改 `FLIGHT_SEARCH_*` 則重新部署 Pages Function 即可。

> 2026-07-09 整理：Cloudflare Pages `flight-search-web` 已重建為內建 GitHub integration，Git Provider = Yes，連線 `jack926509/Flight-search-web`；截圖中另一個同名 Worker 已刪除。正式方向是保留唯一 Pages，並由 Cloudflare 從 GitHub `main` 自動部署。

## 3. 本機開發 / E2E（不進任何後台）

| 變數 | 用途 |
|---|---|
| `E2E_BASE_URL` | Playwright 目標網址（預設 `http://localhost:3000`） |
| `E2E_CACHED_DATE` | 排程已抓過的日期（YYYY-MM-DD），讓 E2E 打快取不打真實資料源（G4） |

## 4. 部署順序（變數相依關係）

1. ~~Supabase 建專案 → 執行 schema~~ ✅ 已完成（`schema.sql` + `schema_v2.sql` + `schema_v3.sql` + `schema_v4.sql` 已套用、RLS 已啟用；security/performance advisors 0 筆）
2. ~~`openssl rand -hex 24` 產生 `API_TOKEN`~~ ✅ 已完成並設於 Zeabur
3. ~~Zeabur 部署後端~~ ✅ 已完成（Docker / FastAPI / uvicorn）
4. Cloudflare Pages 設定 `FLIGHT_SEARCH_API_URL` / `FLIGHT_SEARCH_API_TOKEN` → 部署前端與 `functions/` proxy：Direct Upload 舊站已完成；GitHub integration 需依上方設定修正後重新部署
5. ~~回 Zeabur 把 `ALLOWED_ORIGINS` 改成 Pages 網域 → 重啟~~ ✅ 已完成
6. UptimeRobot 打 `https://flight-search-api.zeabur.app/api/health`（5 分鐘）⬜ 待設定

## 5. UptimeRobot

建立 HTTP(s) monitor：

| 欄位 | 值 |
|---|---|
| URL | `https://flight-search-api.zeabur.app/api/health` |
| Interval | 5 minutes |
| Expected status | 200 |

`/api/health` 免 token，會同時 ping Supabase，能避免 Supabase Free 專案閒置暫停。
