"use client";

import { useEffect, useState } from "react";

interface Props {
  defaultPrice: number;
  disabled?: boolean;
  onTrack: (targetPrice: number) => Promise<void>;
}

export default function TrackPriceAction({ defaultPrice, disabled = false, onTrack }: Props) {
  const [target, setTarget] = useState(defaultPrice);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  useEffect(() => {
    setTarget(defaultPrice);
    setStatus("idle");
  }, [defaultPrice]);

  const submit = async () => {
    if (!target || target <= 0) return;
    setStatus("saving");
    try {
      await onTrack(target);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="bg-white border border-line rounded-card shadow-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">追蹤此價格</p>
        <p className="text-xs text-muted">低於目標價或比上次便宜時，會出現在站內追蹤清單</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-muted" htmlFor="target-price">
          目標價
        </label>
        <input
          id="target-price"
          type="number"
          min={1}
          step={100}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="w-32 px-3 py-2 border border-line rounded-lg text-sm bg-white
                     focus:border-primary focus:ring-1 focus:ring-primary outline-none
                     min-h-[40px]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || status === "saving" || !target || target <= 0}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold
                     hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {status === "saving" ? "建立中…" : status === "done" ? "已追蹤" : "追蹤"}
        </button>
        {status === "error" && (
          <span className="text-xs text-red-600">建立失敗</span>
        )}
      </div>
    </div>
  );
}
