"use client";

import { useEffect, useState } from "react";
import { fetchPriceHistory, type PricePoint } from "@/lib/api";
import dynamic from "next/dynamic";

const Line = dynamic(
  () =>
    import("recharts").then((m) => {
      const { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } = m;
      function Chart({ data }: { data: PricePoint[] }) {
        const fastData = data.filter((d) => d.source === "fast_flights");
        const kiwiData = data.filter((d) => d.source === "kiwi");

        return (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) =>
                  v >= 10000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                }
                width={48}
              />
              <Tooltip
                formatter={(v: number) => [`NT$ ${v.toLocaleString()}`, "最低價"]}
                labelFormatter={(l: string) => `日期：${l}`}
              />
              <Legend />
              {fastData.length > 0 && (
                <Line
                  type="monotone"
                  data={fastData}
                  dataKey="lowest_price_twd"
                  stroke="var(--color-primary)"
                  dot={false}
                  name="Google Flights"
                  strokeWidth={2}
                />
              )}
              {kiwiData.length > 0 && (
                <Line
                  type="monotone"
                  data={kiwiData}
                  dataKey="lowest_price_twd"
                  stroke="#55702F"
                  dot={false}
                  name="Kiwi.com"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        );
      }
      return { default: Chart };
    }),
  { ssr: false }
);

interface Props {
  route: string; // e.g. "TPE-NRT"
}

export default function PriceTrendSection({ route }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data.length > 0) return;
    setLoading(true);
    fetchPriceHistory(route, 90)
      .then(setData)
      .finally(() => setLoading(false));
  }, [open, route, data.length]);

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium
                   text-ink hover:bg-field transition-colors min-h-[44px]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span>價格趨勢（近 90 天）</span>
        <span
          aria-hidden
          className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5">
          {loading && (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted">
              載入中…
            </div>
          )}
          {!loading && data.length < 3 && (
            <div
              aria-label="價格趨勢資料累積中，目前不足 3 個資料點"
              className="h-[200px] flex items-center justify-center text-sm text-muted"
            >
              📊 價格趨勢累積中（目前 {data.length} 筆）
            </div>
          )}
          {!loading && data.length >= 3 && <Line data={data} />}
        </div>
      )}
    </div>
  );
}
