"use client";

import type { ReactNode } from "react";
import type { Flight } from "@/lib/api";
import {
  TIME_OF_DAY_LABELS,
  TIME_OF_DAY_SLOTS,
  getAirlineFilterOptions,
  isFlightFilterActive,
  type FlightFilterState,
  type TimeOfDaySlot,
} from "@/lib/filterFlights";

interface Props {
  /** 用來動態彙整航空公司清單的當批結果（篩選器不需要，只需結果來源） */
  flights: Flight[];
  filters: FlightFilterState;
  onChange: (next: FlightFilterState) => void;
  /** 多段行程只提供直飛開關，不顯示航空公司／時段 */
  showAirlineFilter?: boolean;
  showTimeFilter?: boolean;
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`px-3 py-1.5 rounded-full text-xs font-medium shrink-0 min-h-[36px] border transition-colors
        ${selected
          ? "bg-primary text-white border-primary"
          : "bg-white text-muted border-line hover:border-primary/40 hover:bg-field"}`}
    >
      {children}
    </button>
  );
}

export default function FlightFilterBar({
  flights,
  filters,
  onChange,
  showAirlineFilter = true,
  showTimeFilter = true,
}: Props) {
  const airlineOptions = showAirlineFilter ? getAirlineFilterOptions(flights) : [];

  const toggleDirect = () => onChange({ ...filters, directOnly: !filters.directOnly });

  const toggleAirline = (code: string) => {
    const has = filters.airlineCodes.includes(code);
    onChange({
      ...filters,
      airlineCodes: has
        ? filters.airlineCodes.filter((c) => c !== code)
        : [...filters.airlineCodes, code],
    });
  };

  const toggleTime = (slot: TimeOfDaySlot) => {
    onChange({ ...filters, timeOfDay: filters.timeOfDay === slot ? null : slot });
  };

  const clearAll = () => onChange({ directOnly: false, airlineCodes: [], timeOfDay: null });

  return (
    <div
      role="group"
      aria-label="結果篩選"
      className="flex items-center gap-2 overflow-x-auto pb-1"
    >
      <Chip selected={filters.directOnly} onClick={toggleDirect}>
        直飛
      </Chip>

      {showAirlineFilter &&
        airlineOptions.map((a) => (
          <Chip key={a.code} selected={filters.airlineCodes.includes(a.code)} onClick={() => toggleAirline(a.code)}>
            {a.name}
          </Chip>
        ))}

      {showTimeFilter &&
        TIME_OF_DAY_SLOTS.map((slot) => (
          <Chip key={slot} selected={filters.timeOfDay === slot} onClick={() => toggleTime(slot)}>
            {TIME_OF_DAY_LABELS[slot]}
          </Chip>
        ))}

      {isFlightFilterActive(filters) && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-muted hover:text-muted underline shrink-0 min-h-[36px] px-1"
        >
          清除篩選
        </button>
      )}
    </div>
  );
}
