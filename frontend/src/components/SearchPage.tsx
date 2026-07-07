"use client";

import SearchCard from "./SearchCard";
import ResultsSection from "./ResultsSection";
import { useSearch } from "@/hooks/useSearch";

export default function SearchPage() {
  const {
    origin, setOrigin,
    dest, setDest,
    date, setDate,
    adults, setAdults,
    cabin, setCabin,
    status, result, error,
    sortBy, setSortBy,
    handleSubmit, swapAirports, retry, goDate,
    today,
  } = useSearch();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 bg-white shadow-sm flex items-center px-6 justify-between">
        <h1 className="text-lg font-bold text-gray-900">✈ FlightSearch</h1>
        <div
          className="flex items-center gap-1.5 text-xs text-gray-400"
          aria-label="系統狀態"
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              status === "error" ? "bg-red-500" : "bg-green-400"
            }`}
          />
          {status === "error" ? "異常" : "正常"}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-8">
        <SearchCard
          origin={origin}
          dest={dest}
          date={date}
          adults={adults}
          cabin={cabin}
          today={today}
          loading={status === "loading"}
          onOriginChange={setOrigin}
          onDestChange={setDest}
          onDateChange={setDate}
          onAdultsChange={setAdults}
          onCabinChange={setCabin}
          onSwap={swapAirports}
          onSubmit={handleSubmit}
        />

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
        />
      </main>

      <footer className="py-4 text-center text-xs text-gray-300">
        資料來自 Google Flights 及 Kiwi.com，僅供參考，實際票價以訂票頁為準
      </footer>
    </div>
  );
}
