# Cloudflare GitHub 部署整理

> 目標：Cloudflare 前端只保留一條正式部署路徑，由 Cloudflare Pages 內建 GitHub integration 從 GitHub `main` 分支自動建置。
> 本檔只記設定，不存放任何 API token 或密鑰。

## 目前畫面判讀

Cloudflare「Workers 和 Pages」目前看到兩個同名項目：

1. `flight-search-web` / `flight-search-web-29x.pages.dev`
   - 類型：Pages
   - 狀態：已重建為 Cloudflare Pages 內建 GitHub 部署。
   - GitHub source：`jack926509/Flight-search-web`

2. `flight-search-web` / `jack926509/Flight-search-web`
   - 類型：Workers 項目，不是 Pages 前端站。
   - 狀態：已刪除。
   - 原因：不是 Pages 前端、沒有使用中路由，且與正式 Pages 同名造成混淆。

## 正式保留方案

保留唯一 Cloudflare Pages 專案作為正式站，並由 Cloudflare Pages 內建 GitHub integration 自動部署：

- GitHub repository：`jack926509/Flight-search-web`
- Production branch：`main`
- Cloudflare Pages project：`flight-search-web`
- Cloudflare Pages domain：`flight-search-web-29x.pages.dev`
- Cloudflare build root：`frontend`
- Cloudflare build command：`npm run build`
- Cloudflare output directory：`out`
- Node.js version：`22`

理由：

- 本 repo 是 monorepo，前端專案實際在 `frontend/`。
- `frontend/next.config.ts` 已設定 `output: "export"`，`npm run build` 會輸出靜態網站到 `frontend/out`。
- push 到 GitHub `main` 後，Cloudflare Pages 會直接從 GitHub repo 自動建置並部署。
- Cloudflare 畫面會顯示 Git Provider = Yes，並顯示 `jack926509/Flight-search-web`。

## Cloudflare Pages 環境變數

在 Cloudflare Pages 專案的 Production 環境設定：

| 變數 | 值 | 說明 |
|---|---|---|
| `FLIGHT_SEARCH_API_URL` | `https://flight-search-api.zeabur.app` | Pages Function proxy 的後端網址 |
| `FLIGHT_SEARCH_API_TOKEN` | 與 Zeabur 後端 `API_TOKEN` 相同 | Secret，不可進 repo |
| `NEXT_PUBLIC_API_URL` | 留空 | Production 走同網域 `/api/*` |
| `NEXT_PUBLIC_API_TOKEN` | 留空 | 不把 token 打包進瀏覽器 |

Preview 環境沿用同樣的 `FLIGHT_SEARCH_API_URL` 與 `FLIGHT_SEARCH_API_TOKEN`。

## 舊 Direct Upload 專案處理

不要刪除 `flight-search-web-29x.pages.dev`，這是唯一正式前端 Pages。同名 Worker `flight-search-web` 已於 2026-07-09 刪除，因為它不是 Pages 前端、沒有使用中路由，會造成 Cloudflare 清單混淆。

刪除 Worker 後，完成以下驗收：

1. Cloudflare Pages 專案 `flight-search-web` 顯示 Git Provider = Yes。
2. `https://flight-search-web-29x.pages.dev/` 首頁 HTTP 200。
3. `https://flight-search-web-29x.pages.dev/api/health` HTTP 200，且可連到 Zeabur 後端。
4. Zeabur `ALLOWED_ORIGINS` 已包含 `https://flight-search-web-29x.pages.dev`。
5. GitHub `main` push 會觸發 Cloudflare Pages production deployment。

以上完成後，Cloudflare 前端只剩一個正式 Pages 專案。

## 建置失敗最常見原因

若 Cloudflare GitHub deployment 失敗，優先檢查：

1. Cloudflare build root 是否為 `frontend`。
2. Cloudflare build command 是否為 `npm run build`。
3. Cloudflare output directory 是否為 `out`。
4. `frontend/package-lock.json` 是否和 `package.json` 同步。
5. `frontend/functions/api/[[path]].js` 是否仍存在，否則 `/api/*` proxy 不會部署。
6. Cloudflare Pages production 環境變數 `FLIGHT_SEARCH_API_TOKEN` 是否與 Zeabur `API_TOKEN` 相同。
7. Zeabur `ALLOWED_ORIGINS` 是否允許 Pages domain。

## 完成後的正式部署流程

日後正式部署只做：

```bash
git push origin main
```

Cloudflare Pages 會自動從 GitHub `main` 建置並發布。不要再用 Direct Upload 或 GitHub Actions Wrangler deploy 當正式流程，除非 Cloudflare GitHub integration 故障且需要臨時救援。

## 2026-07-09 驗收紀錄

- Cloudflare Pages project `flight-search-web` 已重建為 GitHub provider。
- GitHub source：`jack926509/Flight-search-web`
- Production branch：`main`
- Build root：`frontend`
- Build command：`npm run build`
- Output directory：`out`
- Production / Preview env var keys：`FLIGHT_SEARCH_API_URL`、`FLIGHT_SEARCH_API_TOKEN`

## 2026-07-10 最終驗收紀錄

- Cloudflare Dashboard Git repository：`jack926509/Flight-search-web`
- 自動部署：已啟用
- 組建監看式路徑：`*`
- 驗證 commit：`0ae7b13`（`chore: 驗證 Cloudflare Dashboard GitHub 連線`）
- Production deployment：`4ba58fb1-9671-45ac-b627-17a9701ebcd4`
- Deployment URL：`https://4ba58fb1.flight-search-web-29x.pages.dev`
- Production URL：`https://flight-search-web-29x.pages.dev`
- 驗收結果：
  - `npm run build` 通過
  - `git push origin main` 成功觸發 Cloudflare Pages production deployment
  - `https://flight-search-web-29x.pages.dev/` HTTP 200
  - `https://flight-search-web-29x.pages.dev/deployment.txt` HTTP 200，內容含 `Dashboard reconnect verified: 2026-07-10 11:20:06 CST`
  - `https://flight-search-web-29x.pages.dev/api/health` HTTP 200，回傳 `status: ok`、`db: true`
