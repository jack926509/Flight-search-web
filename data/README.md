# /data

## airports.csv（不入版控，12+ MB）

來源：OurAirports 開放資料。重新下載：

```bash
curl -sSL -o data/airports.csv \
  https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv
```

轉換成前端用的 `frontend/public/airports.json`（已入版控，約 276 KB）：

```bash
cd frontend && npm run build:airports
```

篩選規則：`large_airport` / `medium_airport`、有 IATA 三碼、`scheduled_service = yes`。
