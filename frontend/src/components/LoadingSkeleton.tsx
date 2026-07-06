"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "正在比對航班…",
  "查詢通常需要 5–8 秒",
  "快好了…",
];

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-3 w-48" />
        </div>
        <div className="space-y-2 text-right">
          <div className="skeleton h-6 w-24 ml-auto" />
          <div className="skeleton h-3 w-16 ml-auto" />
        </div>
      </div>
    </div>
  );
}

export default function LoadingSkeleton() {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setMsgIdx((i) => (i + 1) % MESSAGES.length),
      2500
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-gray-500 py-2 transition-opacity">
        {MESSAGES[msgIdx]}
      </p>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
