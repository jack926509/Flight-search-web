# Cloudflare GitHub 部署整理

> 目標：Cloudflare 前端只保留一條正式部署路徑，從 GitHub `main` 分支自動建置。
> 本檔只記設定，不存放任何 API token 或密鑰。

## 目前畫面判讀

Cloudflare「Workers 和 Pages」目前看到兩個同名項目：

1. `flight-search-web` / `flight-search-web-29x.pages.dev`
   - 類型：Pages
   - 狀態：可用
   - 問題：沒有 Git 連線，屬於 Direct Upload 舊部署。

2. `flight-search-web` / `jack926509/Flight-search-web`
   - 類型：GitHub 連線部署項目
   - 狀態：最新組建失敗，且目前無使用中路由。
   - 目標：修正 build 設定後，升級為唯一正式前端部署。

## 正式保留方案

保留 GitHub 連線的 Cloudflare Pages 專案作為正式站：

- GitHub repository：`jack926509/Flight-search-web`
- Production branch：`main`
- Root directory：`frontend`
- Framework preset：`Next.js (Static HTML Export)`，若沒有此選項則選 None
- Build command：`npm run build`
- Build output directory：`out`
- Node.js version：`22`

理由：

- 本 repo 是 monorepo，前端專案實際在 `frontend/`。
- `frontend/next.config.ts` 已設定 `output: "export"`，`npm run build` 會輸出靜態網站到 `frontend/out`。
- Cloudflare Pages GitHub 連線後，push 到 `main` 就會自動建置，不需要手動 Direct Upload。

## Cloudflare Pages 環境變數

在 Cloudflare Pages 專案的 Production 環境設定：

| 變數 | 值 | 說明 |
|---|---|---|
| `NODE_VERSION` | `22` | 固定 Pages build image 的 Node 版本 |
| `FLIGHT_SEARCH_API_URL` | `https://flight-search-api.zeabur.app` | Pages Function proxy 的後端網址 |
| `FLIGHT_SEARCH_API_TOKEN` | 與 Zeabur 後端 `API_TOKEN` 相同 | Secret，不可進 repo |
| `NEXT_PUBLIC_API_URL` | 留空 | Production 走同網域 `/api/*` |
| `NEXT_PUBLIC_API_TOKEN` | 留空 | 不把 token 打包進瀏覽器 |

Preview 環境可以沿用同樣的 `FLIGHT_SEARCH_API_URL`，但 `FLIGHT_SEARCH_API_TOKEN` 一樣要在 Cloudflare 後台用 secret 設定。

## 舊 Direct Upload 專案處理

不要立即刪除舊的 `flight-search-web-29x.pages.dev`。先完成以下驗收：

1. GitHub 連線 Pages 專案的 `main` 最新 deployment 成功。
2. 新 Pages 網址首頁 HTTP 200。
3. 新 Pages 網址 `/api/health` HTTP 200，且可連到 Zeabur 後端。
4. Zeabur `ALLOWED_ORIGINS` 已加入新的 Pages production domain。
5. 使用新網址跑過 375px Playwright smoke 或人工手機驗收。

以上完成後，再由使用者確認是否刪除舊 Direct Upload 專案。刪除前應確認沒有自訂網域、監控、書籤或文件仍指向舊網址。

## 建置失敗最常見原因

若 GitHub 連線的項目建置失敗，優先檢查：

1. Root directory 是否設為 `frontend`。若留空，Cloudflare 會在 repo 根目錄找 `package.json`，本專案會失敗。
2. Output directory 是否設為 `out`。不要填 `frontend/out`，因為 root 已經是 `frontend`。
3. Build command 是否是 `npm run build`。
4. `NODE_VERSION` 是否設為 `22`。
5. Cloudflare Pages Functions 是否有部署到 `frontend/functions/api/[[path]].js`。
6. `FLIGHT_SEARCH_API_TOKEN` 是否與 Zeabur `API_TOKEN` 相同。

## 完成後的正式部署流程

日後正式部署只做：

```bash
git push origin main
```

Cloudflare Pages 會自動從 GitHub `main` 建置並發布。不要再用 Direct Upload 當正式流程，除非 GitHub 自動部署故障且需要臨時救援。
