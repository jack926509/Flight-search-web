"use client";

import { formatAirlineLabel, formatDuration } from "@/lib/api";
import type { Flight } from "@/lib/api";
import AirlineIcon from "./AirlineIcon";

interface Props {
  flight: Flight;
  cheapest: boolean;
}

export default function FlightCard({ flight, cheapest }: Props) {
  const hasConversion = !!flight.original_currency && flight.original_currency !== flight.currency;
  const airline = formatAirlineLabel(flight.airline, flight.flight_no);

  return (
    <a
      href={flight.booking_hint}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${airline.name} ${airline.detail} — ${flight.depart_time} 到 ${flight.arrive_time} — NT$ ${flight.price.toLocaleString()} — 在 Google Flights 查看`}
      className="block bg-white rounded-card border border-line shadow-card px-5 py-4 hover:shadow-cardHover
                 hover:border-primary hover:-translate-y-0.5 transition-all duration-200 group min-h-[80px]"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: airline + route */}
        <div className="flex items-center gap-3 min-w-0">
          <AirlineIcon code={airline.code} logoUrl={airline.logoUrl} name={airline.name} />
          <div className="min-w-0">
            <div>
              <div className="font-semibold text-sm text-ink">
                {airline.name}
              </div>
              {airline.detail && (
                <div className="mt-0.5 text-xs text-muted">{airline.detail}</div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted">
              <span className="font-medium">{flight.depart_time}</span>
              <span className="text-muted">—</span>
              <span className="text-xs text-muted">{formatDuration(flight.duration_min)}</span>
              <span className="text-muted">—</span>
              <span className="font-medium">{flight.arrive_time}</span>
            </div>
          </div>
          {flight.stops === 0 ? (
            <span className="text-xs text-green bg-green-soft px-2 py-0.5 rounded-full shrink-0">
              直飛
            </span>
          ) : (
            <span className="text-xs text-muted bg-field px-2 py-0.5 rounded-full shrink-0">
              {flight.stops} 轉
            </span>
          )}
        </div>

        {/* Right: price */}
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-price">
            NT$ {flight.price.toLocaleString()}
          </div>
          {hasConversion && (
            <div className="text-xs text-muted mt-0.5" title={`原始幣別：${flight.original_currency}`}>
              約（換算自 {flight.original_currency}）
            </div>
          )}
          {cheapest && (
            <span className="inline-block mt-1 text-xs font-bold text-price
                             bg-price/10 ring-1 ring-price/25 px-2 py-0.5 rounded-full">
              最便宜
            </span>
          )}
          <div className="text-xs text-primary group-hover:underline mt-1">
            在 Google Flights 查看 →
          </div>
        </div>
      </div>
    </a>
  );
}
