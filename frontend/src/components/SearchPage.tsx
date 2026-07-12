"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import SearchCard from "./SearchCard";
import ResultsSection from "./ResultsSection";
import RoundTripResults from "./RoundTripResults";
import MultiSearchCard from "./MultiSearchCard";
import MultiLegResults from "./MultiLegResults";
import ComboSearchCard from "./ComboSearchCard";
import ComboMatrix from "./ComboMatrix";
import StationScanCard from "./StationScanCard";
import StationScanResults from "./StationScanResults";
import TrackerDrawer from "./TrackerDrawer";
import { useSearch } from "@/hooks/useSearch";
import { useMultiSearch } from "@/hooks/useMultiSearch";
import { useComboSearch } from "@/hooks/useComboSearch";
import { useStationScan } from "@/hooks/useStationScan";
import { useHealth } from "@/hooks/useHealth";
import { useTrackers } from "@/hooks/useTrackers";

/** 首頁熱門航線快速鍵：點擊只填表單（TPE → 代碼），不自動送出搜尋 */
const POPULAR_ROUTES = [
  { label: "東京 NRT", code: "NRT" },
  { label: "大阪 KIX", code: "KIX" },
  { label: "首爾 ICN", code: "ICN" },
  { label: "曼谷 BKK", code: "BKK" },
  { label: "香港 HKG", code: "HKG" },
  { label: "新加坡 SIN", code: "SIN" },
];

export default function SearchPage() {
  const {
    origin, setOrigin,
    dest, setDest,
    date, setDate,
    tripType, setTripType,
    returnDate, setReturnDate,
    adults, setAdults,
    cabin, setCabin,
    status, result, error,
    returnStatus, returnResult, returnError,
    sortBy, setSortBy,
    selectedOutbound, setSelectedOutbound,
    selectedReturn, setSelectedReturn,
    roundTripTotal,
    handleSubmit, swapAirports, retry, goDate,
    today,
  } = useSearch();

  const multi = useMultiSearch();
  const combo = useComboSearch();
  const scan = useStationScan();
  const trackers = useTrackers();
  const searchParams = useSearchParams();
  const urlMode = searchParams.get("mode");
  const [mode, setMode] = useState<"single" | "multi" | "combo" | "scan">(
    urlMode === "multi" ? "multi" : urlMode === "combo" ? "combo" : urlMode === "scan" ? "scan" : "single"
  );

  const health = useHealth();
  // 狀態燈以真實 /api/health 為準；上次搜尋失敗也視為異常訊號
  const light =
    health.level === "down" || status === "error"
      ? { color: "bg-danger", text: "異常", hint: "後端服務無回應" }
      : health.level === "degraded"
        ? { color: "bg-yellow-400", text: "部分異常", hint: "資料庫離線，快取與價格歷史暫停，即時查詢仍可用" }
        : { color: "bg-green-400", text: "正常", hint: "所有服務正常" };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header：純白底＋細底線，不用毛玻璃 */}
      <header className="sticky top-0 z-40 h-14 bg-white border-b border-line flex items-center px-6 justify-between">
        <h1 className="text-lg font-extrabold text-primary">✈ FlightSearch</h1>
        <div className="flex items-center gap-3">
          <TrackerDrawer
            trackers={trackers.trackers}
            events={trackers.events}
            unreadCount={trackers.unreadCount}
            loading={trackers.loading}
            error={trackers.error}
            onReload={() => void trackers.reload()}
            onToggle={(id, enabled) => void trackers.setTrackerEnabled(id, enabled)}
            onMarkRead={(id) => void trackers.markTrackerRead(id)}
            onDelete={(id) => void trackers.removeTracker(id)}
            trackerKey={trackers.trackerKey}
            onRestore={(key) => trackers.restore(key)}
          />
          <div
            className="flex items-center gap-1.5 text-xs text-muted"
            aria-label="系統狀態"
            title={light.hint}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${light.color}`} />
            {light.text}
          </div>
        </div>
      </header>

      <div className="px-4 pt-3">
        <details className="w-full max-w-3xl mx-auto rounded-lg border border-line bg-white text-xs text-muted">
          <summary className="cursor-pointer px-4 py-3 font-medium text-ink">系統與資料狀態</summary>
          <div className="border-t border-line-soft px-4 py-3 space-y-2 text-pretty">
            <p>資料庫：{health.db === true ? "正常" : health.db === false ? "暫時無法使用；即時查詢可能仍可用" : "尚未設定或尚未取得狀態"}</p>
            {Object.entries(health.providers).map(([name, provider]) => (
              <p key={name}>
                {name === "fast_flights" ? "Google Flights" : "Kiwi.com"}：{provider.reachable ? "近期正常" : "近期異常"}
                {provider.last_success_at ? `・最近成功 ${new Date(provider.last_success_at).toLocaleString("zh-TW")}` : ""}
                {provider.last_failure_at ? `・最近失敗 ${new Date(provider.last_failure_at).toLocaleString("zh-TW")}` : ""}
              </p>
            ))}
            {Object.entries(health.schedulers).map(([name, scheduler]) => (
              <p key={name}>
                {name === "daily_price_fetch" ? "每日價格整理" : "價格追蹤"}：{scheduler.last_status === "failed" ? "最近一次失敗" : scheduler.last_status === "running" ? "執行中" : "最近一次完成"}
                {scheduler.last_finished_at ? `・${new Date(scheduler.last_finished_at).toLocaleString("zh-TW")}` : ""}
              </p>
            ))}
            <p>所有票價均為查詢當下資料，訂票前仍須以訂票頁為準。</p>
          </div>
        </details>
      </div>

      {/* Main */}
      <main className="flex-1 px-4 py-8">
        {/* 主要入口：先讓一般使用者選目的，再提供外站進階工具 */}
        <div
          role="tablist"
          aria-label="主要查詢方式"
          className="grid grid-cols-2 gap-2 w-full max-w-3xl mx-auto mb-3"
        >
          <button
            role="tab"
            aria-selected={mode === "single"}
            type="button"
            onClick={() => setMode("single")}
            className={`px-4 py-2 rounded-full text-sm font-medium min-h-[44px] transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              mode === "single"
                ? "bg-primary text-white shadow-card"
                : "bg-white border border-line text-muted hover:bg-field hover:border-primary/40"
            }`}
          >
            一般找票
          </button>
          <button
            role="tab"
            aria-selected={mode !== "single"}
            type="button"
            onClick={() => setMode("scan")}
            className={`px-4 py-2 rounded-full text-sm font-medium min-h-[44px] transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              mode !== "single"
                ? "bg-primary text-white shadow-card"
                : "bg-white border border-line text-muted hover:bg-field hover:border-primary/40"
            }`}
          >
            找外站便宜票
          </button>
        </div>

        {mode !== "single" && (
          <div className="flex flex-wrap justify-center gap-2 w-full max-w-3xl mx-auto mb-4" aria-label="外站進階工具">
            {([
              ["scan", "外站範圍掃描"],
              ["combo", "定位票日期組合"],
              ["multi", "指定多段行程"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`min-h-[40px] rounded-full px-3 py-2 text-xs font-medium ${
                  mode === value ? "bg-primary text-white" : "border border-line bg-white text-muted hover:bg-field"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "single" ? (
          <>
            <SearchCard
              origin={origin}
              dest={dest}
              date={date}
              tripType={tripType}
              returnDate={returnDate}
              adults={adults}
              cabin={cabin}
              today={today}
              loading={status === "loading" || returnStatus === "loading"}
              onOriginChange={setOrigin}
              onDestChange={setDest}
              onDateChange={(value) => {
                setDate(value);
                if (returnDate < value) setReturnDate(value);
              }}
              onTripTypeChange={setTripType}
              onReturnDateChange={setReturnDate}
              onAdultsChange={setAdults}
              onCabinChange={setCabin}
              onSwap={swapAirports}
              onSubmit={handleSubmit}
            />

            {status === "idle" && returnStatus === "idle" && (
              <div className="w-full max-w-3xl mx-auto mt-4">
                <p className="text-sm text-muted mb-2">熱門航線</p>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_ROUTES.map((route) => (
                    <button
                      key={route.code}
                      type="button"
                      onClick={() => {
                        setOrigin("TPE");
                        setDest(route.code);
                      }}
                      className="bg-white border border-line rounded-full px-3 py-1.5 text-sm text-ink
                                 hover:bg-field transition-colors
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {route.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tripType === "round-trip" ? (
              <RoundTripResults
                outbound={{
                  label: "去程",
                  route: `${origin} → ${dest}`,
                  date,
                  status,
                  result,
                  error,
                  selected: selectedOutbound,
                  sortBy,
                  onSelect: setSelectedOutbound,
                }}
                inbound={{
                  label: "回程",
                  route: `${dest} → ${origin}`,
                  date: returnDate,
                  status: returnStatus,
                  result: returnResult,
                  error: returnError,
                  selected: selectedReturn,
                  sortBy,
                  onSelect: setSelectedReturn,
                }}
                total={roundTripTotal}
                onRetry={retry}
                onTrackPrice={(targetPrice) => trackers.addTracker({
                  trip_type: "round-trip",
                  origin,
                  dest,
                  date,
                  return_date: returnDate,
                  adults,
                  cabin,
                  target_price_twd: targetPrice,
                }).then(() => undefined)}
              />
            ) : (
              <ResultsSection
                status={status}
                result={result}
                error={error}
                sortBy={sortBy}
                origin={origin}
                dest={dest}
                onSortChange={setSortBy}
                onRetry={retry}
                onGoDate={goDate}
                onTrackPrice={(targetPrice) => trackers.addTracker({
                  trip_type: "one-way",
                  origin,
                  dest,
                  date,
                  adults,
                  cabin,
                  target_price_twd: targetPrice,
                }).then(() => undefined)}
              />
            )}
          </>
        ) : mode === "multi" ? (
          <>
            <MultiSearchCard
              legs={multi.legs}
              adults={multi.adults}
              cabin={multi.cabin}
              today={multi.today}
              searching={multi.searching}
              allLegsFilled={multi.allLegsFilled}
              onLegChange={multi.updateLeg}
              onAddLeg={multi.addLeg}
              onRemoveLeg={multi.removeLeg}
              onAdultsChange={multi.setAdults}
              onCabinChange={multi.setCabin}
              onSubmit={multi.searchAll}
            />

            <MultiLegResults
              legs={multi.legs}
              legStates={multi.legStates}
              total={multi.total}
              unpricedCount={multi.unpricedCount}
              onRetryLeg={multi.retryLeg}
              onSelectFlight={multi.selectFlight}
            />
          </>
        ) : mode === "combo" ? (
          <>
            <ComboSearchCard
              legA={combo.legA}
              legB={combo.legB}
              adults={combo.adults}
              cabin={combo.cabin}
              today={combo.today}
              running={combo.running}
              filled={combo.filled}
              onLegAChange={combo.setLegA}
              onLegBChange={combo.setLegB}
              onAdultsChange={combo.setAdults}
              onCabinChange={combo.setCabin}
              onSubmit={combo.runSearch}
            />

            <ComboMatrix
              snapshot={combo.snapshot}
              resultsA={combo.resultsA}
              resultsB={combo.resultsB}
              running={combo.running}
              progress={combo.progress}
            />
          </>
        ) : (
          <>
            <StationScanCard
              dest={scan.dest}
              fromDate={scan.fromDate}
              toDate={scan.toDate}
              stations={scan.stations}
              adults={scan.adults}
              cabin={scan.cabin}
              today={scan.today}
              running={scan.running}
              filled={scan.filled}
              daysOk={scan.daysOk}
              stationsOk={scan.stationsOk}
              dayCount={scan.dayCount}
              queryCount={scan.queryCount}
              onDestChange={scan.setDest}
              onFromDateChange={scan.setFromDate}
              onToDateChange={scan.setToDate}
              onStationsChange={scan.setStations}
              onAdultsChange={scan.setAdults}
              onCabinChange={scan.setCabin}
              onSubmit={scan.runSearch}
            />

            <StationScanResults
              snapshot={scan.snapshot}
              results={scan.results}
              running={scan.running}
              progress={scan.progress}
              onCancel={() => void scan.cancel()}
            />
          </>
        )}
      </main>

      <footer className="py-4 text-center text-xs text-muted">
        資料來自 Google Flights 及 Kiwi.com，僅供參考，實際票價以訂票頁為準
      </footer>
    </div>
  );
}
