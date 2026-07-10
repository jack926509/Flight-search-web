"use client";

import { useState } from "react";

const AIRLINE_STYLES: Record<string, { bg: string; fg: string; ring: string }> = {
  BR: { bg: "#047857", fg: "#FFFFFF", ring: "#A7F3D0" },
  CI: { bg: "#1D4ED8", fg: "#FFFFFF", ring: "#BFDBFE" },
  HX: { bg: "#DC2626", fg: "#FFFFFF", ring: "#FECACA" },
  TK: { bg: "#B91C1C", fg: "#FFFFFF", ring: "#FCA5A5" },
  ZH: { bg: "#2563EB", fg: "#FFFFFF", ring: "#BFDBFE" },
  EY: { bg: "#7C2D12", fg: "#FFFFFF", ring: "#FDBA74" },
  MU: { bg: "#991B1B", fg: "#FFFFFF", ring: "#FECACA" },
  W4: { bg: "#BE185D", fg: "#FFFFFF", ring: "#FBCFE8" },
  FR: { bg: "#1E3A8A", fg: "#FACC15", ring: "#BFDBFE" },
  CA: { bg: "#B91C1C", fg: "#FFFFFF", ring: "#FCA5A5" },
  TW: { bg: "#0F766E", fg: "#FFFFFF", ring: "#99F6E4" },
};

interface Props {
  code?: string;
  logoUrl?: string;
  name: string;
  size?: "sm" | "md";
}

export default function AirlineIcon({ code = "", logoUrl = "", name, size = "md" }: Props) {
  const [logoFailed, setLogoFailed] = useState(false);
  const normalizedCode = code.trim().toUpperCase();
  const displayCode = normalizedCode || name.trim().slice(0, 2).toUpperCase() || "FL";
  const style = AIRLINE_STYLES[normalizedCode] ?? {
    bg: "#334155",
    fg: "#FFFFFF",
    ring: "#CBD5E1",
  };
  const sizeClass = size === "sm" ? "h-9 w-9 text-[11px]" : "h-10 w-10 text-xs";
  const imgClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";

  return (
    <span
      aria-label={`${name} 圖示`}
      title={`${name}（${displayCode}）`}
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white font-bold tracking-normal shadow-sm`}
      style={{
        backgroundColor: logoUrl && !logoFailed ? "#FFFFFF" : style.bg,
        borderColor: style.ring,
        color: style.fg,
      }}
    >
      {logoUrl && !logoFailed ? (
        <img
          src={logoUrl}
          alt=""
          aria-hidden
          className={`${imgClass} object-contain`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        displayCode
      )}
    </span>
  );
}
