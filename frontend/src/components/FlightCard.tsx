"use client";

import { formatDuration } from "@/lib/api";
import type { Flight } from "@/lib/api";

interface Props {
  flight: Flight;
  cheapest: boolean;
}

export default function FlightCard({ flight, cheapest }: Props) {
  const hasConversion = !!flight.original_currency && flight.original_currency !== flight.currency;

  return (
    <a
      href={flight.booking_hint}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${flight.airline} ${flight.flight_no || ""} — ${flight.depart_time} 到 ${flight.arrive_time} — NT$ ${flight.price.toLocaleString()} — 在 Google Flights 查看`}
      className="block bg-white rounded-xl border border-gray-200 px-5 py-4 hover:shadow-md
                 hover:border-[#0B5FFF] transition-all group min-h-[80px]"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: airline + route */}
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="font-semibold text-sm text-gray-800">
              {flight.airline}
              {flight.flight_no && (
                <span className="ml-1 text-xs text-gray-400">{flight.flight_no}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <span className="font-medium">{flight.depart_time}</span>
              <span className="text-gray-300">—</span>
              <span className="text-xs text-gray-400">{formatDuration(flight.duration_min)}</span>
              <span className="text-gray-300">—</span>
              <span className="font-medium">{flight.arrive_time}</span>
            </div>
          </div>
          {flight.stops === 0 ? (
            <span className="text-xs text-[#0A7A3D] bg-green-50 px-2 py-0.5 rounded-full shrink-0">
              直飛
            </span>
          ) : (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
              {flight.stops} 轉
            </span>
          )}
        </div>

        {/* Right: price */}
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-[#0A7A3D]">
            NT$ {flight.price.toLocaleString()}
          </div>
          {hasConversion && (
            <div className="text-xs text-gray-400 mt-0.5" title={`原始幣別：${flight.original_currency}`}>
              約（換算自 {flight.original_currency}）
            </div>
          )}
          {cheapest && (
            <span className="inline-block mt-1 text-xs font-bold text-[#0A7A3D]
                             bg-green-100 px-2 py-0.5 rounded-full">
              最便宜
            </span>
          )}
          <div className="text-xs text-[#0B5FFF] group-hover:underline mt-1">
            在 Google Flights 查看 →
          </div>
        </div>
      </div>
    </a>
  );
}
