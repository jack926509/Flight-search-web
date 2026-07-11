"use client";

import { useState } from "react";

interface Props {
  className?: string;
}

/** 複製當前網址（含查詢條件）分享給同事；開連結會自動帶入查詢並執行搜尋 */
export default function ShareLinkButton({ className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const copyWithExecCommand = (url: string): boolean => {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(textarea);
    return ok;
  };

  const handleClick = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;

    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      ok = copyWithExecCommand(url);
    }

    if (ok) {
      setManualUrl(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // 兩種複製方式都失敗：顯示網址讓使用者手動複製
      setCopied(false);
      setManualUrl(url);
    }
  };

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                   border transition-colors min-h-[36px] shrink-0
                   ${copied
                     ? "bg-green-soft border-green/30 text-green"
                     : "bg-white text-muted border-line hover:border-primary/40 hover:bg-field"}`}
      >
        {copied ? "✓ 已複製" : "🔗 複製分享連結"}
      </button>
      {manualUrl && (
        <p className="text-xs text-muted break-all max-w-xs">
          複製失敗，請手動複製網址：{manualUrl}
        </p>
      )}
    </div>
  );
}
