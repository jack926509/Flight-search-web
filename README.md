# Flight Search Web

> **專案狀態：維修中，尚無正式前端與後端。**
>
> 最後更新：2026-09-02（Asia/Taipei）

本 repository 保留完整的 Next.js 前端、FastAPI 後端及 Supabase schema，供日後改用其他後端平台重新建置。Zeabur 後端專案與 Cloudflare Pages 前端專案均已移除，GitHub Actions 的後端保活排程也已停止。

Supabase 專案、第三方服務及既有機密目前未重新確認。接手者應把它們視為「狀態未知」，先查證或重建，再開始部署。`DEPLOYMENT.md`、`CLOUDFLARE_GITHUB_DEPLOYMENT.md` 與 `PROGRESS.md` 只保留歷史紀錄，其中的舊網址、專案 ID 及已完成標記不代表目前環境。

## 接手目標

接手者的第一階段目標是選定新的長時間運行後端平台，重新部署 `backend/`，再讓 `frontend/` 透過同網域代理連線。完成前，機票搜尋、歷史價格、票價追蹤、外站掃描、LINE 通知及背景排程都不應宣稱可用。

重新建置時保留既有 API 契約與資料模型；平台可以更換，不需要還原 Zeabur。

## 系統架構

```text
瀏覽器
  → Next.js 靜態前端（frontend/）
  → 同網域 /api/* 代理（frontend/functions/）
  → FastAPI 長時間運行容器（backend/）
  → Supabase、航班資料來源及選用的 LINE Messaging API
```

目前後端會在程序啟動時建立 APScheduler，外站掃描也依賴背景工作。因此，新平台應支援長時間運行的 Docker／Python 3.12 服務。重新設計排程鎖定前，先使用單一程序與單一 replica，避免多個實例重複執行排程。

## Repository 結構

| 路徑 | 用途 |
|---|---|
| `frontend/` | Next.js 15、React 19 靜態前端與 Playwright E2E |
| `frontend/functions/` | 保護後端 Token 的同網域 API proxy；移轉前端平台時需保留等效功能 |
| `backend/` | Python 3.12、FastAPI、背景排程與航班資料整合 |
| `backend/db/` | Supabase schema 與存取層；schema 需依版本順序核對 |
| `backend/tests/` | 後端 API、搜尋鏈、追蹤與掃描測試 |
| `DEPLOYMENT.md` | 舊 Zeabur／Cloudflare 部署紀錄，只供理解歷史設定 |
| `TROUBLESHOOTING.md` | 既有錯誤排查經驗；涉及舊平台的步驟需改寫後使用 |

## 新後端必須維持的契約

現有前端代理允許下列端點：

- `GET /api/health`
- `GET /api/search`
- `GET /api/history`
- `GET|POST /api/trackers`
- `PATCH|DELETE /api/trackers/{tracker_id}`
- `POST /api/station-scans`
- `GET|DELETE /api/station-scans/{job_id}`

`/api/health` 不需要 Token；其他 `/api/*` 請求使用 `X-API-Token`。票價追蹤另外使用 `X-Tracker-Key`。正式環境應回傳 JSON、設定明確的 CORS 網域，並由伺服器端 proxy 保存 API Token，不得把正式 Token 打包進瀏覽器 JavaScript。

目前 `frontend/public/_headers` 只允許瀏覽器連線同網域。若新的前端平台不支援 `frontend/functions/` 的 Cloudflare Functions 格式，應先實作等效的 server-side proxy，再部署前端。

## 重新建置順序

### 1. 確認外部資源

1. 確認是否保留原 Supabase 專案；找不到或權限不明時建立新專案。
2. 依序核對 `backend/db/schema.sql`、`schema_v2.sql` 至 `schema_v9.sql`，不要假設舊 migration 已存在。
3. 重新產生所有正式環境機密。舊 Zeabur 內使用過的 Token 與 service role key 不視為可直接沿用。
4. 記錄新的後端平台、正式網址、前端平台及網域，再更新本 README 與部署文件。

### 2. 在本機驗證後端

需要 Python 3.12。先確認目前環境的 `python3 --version` 顯示 3.12.x；若不是，先透過版本管理器切換，或改用下方 Docker 流程。正式值只放在被 Git 忽略的 `backend/.env.local`，不要提交到 repository。

後端完整功能至少需要：

| 環境變數 | 用途 |
|---|---|
| `SUPABASE_URL` | Supabase 專案網址 |
| `SUPABASE_SERVICE_KEY` | 後端專用 service role key |
| `API_TOKEN` | 前端 proxy 呼叫後端的驗證 Token |
| `ALLOWED_ORIGINS` | 新前端正式網域；多個網域以逗號分隔 |
| `SITE_URL` | LINE 卡片及分享連結使用的新前端網址 |

LINE 推播為選用功能，需另外設定 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_TARGET_USER_ID`。其他快取、節流、Kiwi MCP 及 proxy 選項請以程式碼與歷史 `DEPLOYMENT.md` 為參考，不要直接複製舊正式值。

```bash
cd backend
python3 --version
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pytest
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --env-file .env.local
```

也可以用現有 Dockerfile 驗證：

```bash
docker build -t flight-search-api ./backend
docker run --rm -p 8000:8000 --env-file backend/.env.local flight-search-api
```

### 3. 部署新後端

選擇支援 Docker 或 Python 3.12、可持續運行背景程序、可設定機密及公開 HTTPS 網域的平台。部署後先驗證：

```bash
curl https://<new-backend-domain>/api/health
```

最低通過條件是 HTTP 200、`status` 為 `ok`，且使用 Supabase 時 `db` 為 `true`。接著再驗證需要 `X-API-Token` 的搜尋、歷史、追蹤及掃描端點。

### 4. 驗證並部署前端

```bash
cd frontend
npm ci
npm run build
```

本機直連後端時，在 `frontend/.env.local` 設定：

```dotenv
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_TOKEN=<local-only-token>
```

正式環境應使用同網域 proxy，並把下列值設在前端平台的伺服器端環境變數：

```dotenv
FLIGHT_SEARCH_API_URL=https://<new-backend-domain>
FLIGHT_SEARCH_API_TOKEN=<same-as-backend-api-token>
```

正式環境不要設定 `NEXT_PUBLIC_API_TOKEN`。若更換 Cloudflare Pages 以外的平台，先確認該平台能執行或已改寫 `frontend/functions/`。

## 重新上線驗收

全部通過後才能把專案狀態改回可用：

- `cd backend && python -m pytest` 全部通過。
- `cd frontend && npm run build` 通過型別檢查與靜態輸出。
- 新後端 `/api/health` 回 HTTP 200，資料庫狀態正確。
- 公開前端的 `/api/health` 能經由 server-side proxy 到達新後端。
- 實際瀏覽器完成一般搜尋、歷史價格、追蹤建立／讀取／刪除及外站掃描。
- 確認排程只執行一次，重啟後未完成的掃描可恢復。
- CORS 僅允許預期網域，正式 Token 未出現在 Git、瀏覽器 bundle 或網路回應中。
- GitHub commit、後端部署版本與公開前端版本可以互相追溯。

## 下次交給開發者或 AI 時怎麼說

可以直接使用下列交接說明，將尖括號內容換成當次決定：

```text
請接手 Flight-search-web，先完整閱讀 README.md，再檢查目前 git status 與外部服務現況。

目前沒有正式前端與後端。目標是使用 <新後端平台> 部署既有 backend/ FastAPI，
Supabase 預計 <保留／重建>，前端預計部署到 <新前端平台與網域>。

請先提出部署架構、機密輪替方式與可檢查的驗收條件；確認後才修改。
保留既有 API 契約與 server-side proxy，不把正式 Token 放進瀏覽器。
本次授權範圍是 <只規劃／直接實作／commit push／部署>。
完成時分別回報：測試、build、遠端 commit SHA、後端健康檢查與公開瀏覽器驗收。
```

這段說明能讓下一位先確認「用哪個後端、是否保留 Supabase、要不要直接發布」，避免把歷史 Zeabur／Cloudflare 設定誤認成仍在使用。
