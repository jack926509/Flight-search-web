"use client";

import { useMemo, useState } from "react";
import type { Flight } from "@/lib/api";
import { calculateExternalCost } from "@/lib/externalCost";

interface Props {
  station: string;
  date: string;
  flight: Flight;
  directPrice: number | null;
}

function amount(value: string): number {
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export default function ExternalCostCard({ station, date, flight, directPrice }: Props) {
  const [open, setOpen] = useState(false);
  const [positioning, setPositioning] = useState("");
  const [baggage, setBaggage] = useState("0");
  const [lodging, setLodging] = useState("0");
  const [transfer, setTransfer] = useState("0");
  const [reserve, setReserve] = useState("0");
  const [separateTickets, setSeparateTickets] = useState(true);
  const [recheckBaggage, setRecheckBaggage] = useState(false);
  const [overnight, setOvernight] = useState(false);

  const result = useMemo(() => calculateExternalCost({
    directPrice,
    mainTicketPrice: flight.price,
    positioningTicketPrice: amount(positioning) || null,
    baggageCost: amount(baggage),
    lodgingCost: amount(lodging),
    transferCost: amount(transfer),
    reserveCost: amount(reserve),
  }), [directPrice, flight.price, positioning, baggage, lodging, transfer, reserve]);

  const verdictText = {
    "needs-positioning": "尚未計入定位票，不能判定是否真的較省",
    "worth-considering": "完整成本仍有明顯節省，值得進一步核對訂票規則",
    "limited-saving": "節省有限或缺少直飛基準，請衡量時間與風險",
    "not-worth-it": "加上已知成本後不比一般出發便宜",
  }[result.verdict];

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="min-h-[44px] rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-primary hover:bg-field"
      >
        {open ? "收起完整成本" : "比較完整成本"}
      </button>
      {open && (
        <section aria-label={`${station} 外站完整成本`} className="mt-2 rounded-lg border border-line bg-field p-3 text-xs text-ink space-y-3">
          <p className="text-pretty">{station} → 目的地（{date}）主票 NT$ {flight.price.toLocaleString()}。定位票與附加成本由你填入，系統不會把估算值當成即時報價。</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ["定位票", positioning, setPositioning, "必填"],
              ["行李費", baggage, setBaggage, "選填"],
              ["必要住宿", lodging, setLodging, "選填"],
              ["機場轉移", transfer, setTransfer, "選填"],
              ["其他預留", reserve, setReserve, "選填"],
            ].map(([label, value, setter, note]) => (
              <label key={label as string} className="block text-muted">
                {label as string}（{note as string}）
                <input
                  inputMode="numeric"
                  value={value as string}
                  onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                  placeholder="NT$"
                  aria-label={`${station} ${label as string}`}
                  className="mt-1 min-h-[40px] w-full rounded border border-line bg-white px-2 text-sm text-ink tabular-nums"
                />
              </label>
            ))}
          </div>
          <div className="space-y-1">
            {[
              ["分開開票，前段延誤通常不保障後段", separateTickets, setSeparateTickets],
              ["可能需要重新托運行李", recheckBaggage, setRecheckBaggage],
              ["可能需要前一晚抵達外站", overnight, setOvernight],
            ].map(([label, checked, setter]) => (
              <label key={label as string} className="flex items-center gap-2">
                <input type="checkbox" checked={checked as boolean} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} />
                <span>{label as string}</span>
              </label>
            ))}
          </div>
          <div className="rounded border border-line bg-white p-3 tabular-nums">
            {directPrice === null ? <p>一般台灣出發：當日無可比較基準</p> : <p>一般台灣出發：NT$ {directPrice.toLocaleString()}</p>}
            <p>外站方案完整成本：{result.total === null ? "待填定位票" : `NT$ ${result.total.toLocaleString()}`}</p>
            {result.saving !== null && <p>預估節省：{result.saving > 0 ? `NT$ ${result.saving.toLocaleString()}` : `多 NT$ ${Math.abs(result.saving).toLocaleString()}`}</p>}
            <p className="mt-1 font-semibold text-primary text-pretty">判斷：{verdictText}</p>
          </div>
        </section>
      )}
    </div>
  );
}
