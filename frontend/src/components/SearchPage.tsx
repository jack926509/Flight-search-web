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
import TrackerDrawer from "./TrackerDrawer";
import { useSearch } from "@/hooks/useSearch";
import { useMultiSearch } from "@/hooks/useMultiSearch";
import { useComboSearch } from "@/hooks/useComboSearch";
import { useHealth } from "@/hooks/useHealth";
import { useTrackers } from "@/hooks/useTrackers";

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
  const trackers = useTrackers();
  const searchParams = useSearchParams();
  const urlMode = searchParams.get("mode");
  const [mode, setMode] = useState<"single" | "multi" | "combo">(
    urlMode === "multi" ? "multi" : urlMode === "combo" ? "combo" : "single"
  );

  const health = useHealth();
  // 狀態燈以真實 /api/health 為準；上次搜尋失敗也視為異常訊號
  const light =
    health === "down" || status === "error"
      ? { color: "bg-red-500", text: "異常", hint: "後端服務無回應" }
      : health === "degraded"
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

      {/* Main */}
      <main className="flex-1 px-4 py-8">
        {/* Mode tabs */}
        <div
          role="tablist"
          aria-label="查詢模式"
          className="flex gap-2 w-full max-w-3xl mx-auto mb-4"
        >
          <button
            role="tab"
            aria-selected={mode === "single"}
            type="button"
            onClick={() => setMode("single")}
            className={`px-4 py-2 rounded-full text-sm font-medium min-h-[44px] transition-all ${
              mode === "single"
                ? "bg-primary text-white shadow-card"
                : "bg-white border border-line text-muted hover:bg-field hover:border-primary/40"
            }`}
          >
            單程 / 來回
          </button>
          <button
            role="tab"
            aria-selected={mode === "multi"}
            type="button"
            onClick={() => setMode("multi")}
            className={`px-4 py-2 rounded-full text-sm font-medium min-h-[44px] transition-all ${
              mode === "multi"
                ? "bg-primary text-white shadow-card"
                : "bg-white border border-line text-muted hover:bg-field hover:border-primary/40"
            }`}
          >
            多段行程（外站・四腿）
          </button>
          <button
            role="tab"
            aria-selected={mode === "combo"}
            type="button"
            onClick={() => setMode("combo")}
            className={`px-4 py-2 rounded-full text-sm font-medium min-h-[44px] transition-all ${
              mode === "combo"
                ? "bg-primary text-white shadow-card"
                : "bg-white border border-line text-muted hover:bg-field hover:border-primary/40"
            }`}
          >
            外站組合比價
          </button>
        </div>

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
        ) : (
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
        )}
      </main>

      <footer className="py-4 text-center text-xs text-muted">
        資料來自 Google Flights 及 Kiwi.com，僅供參考，實際票價以訂票頁為準
      </footer>
    </div>
  );
}
