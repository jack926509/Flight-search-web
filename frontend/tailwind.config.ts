import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0B5FFF",
          dark: "#0A4BD6",
        },
        // 青綠強調色：用於 focus ring、hover 點綴、漸層尾端
        accent: {
          DEFAULT: "#0EA5A5",
          dark: "#0F766E",
        },
        price: "#0A7A3D",
        warning: { DEFAULT: "#B45309", bg: "#FEF3C7" },
        surface: { DEFAULT: "#FFFFFF", bg: "#F5F7FA" },
      },
      fontFamily: {
        sans: [
          "Noto Sans TC",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "1rem",
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,23,42,0.06), 0 10px 30px -14px rgba(11,95,255,0.14)",
        cardHover:
          "0 6px 16px rgba(15,23,42,0.08), 0 20px 44px -16px rgba(14,165,165,0.28)",
        float:
          "0 10px 40px -6px rgba(15,23,42,0.20), 0 4px 12px rgba(15,23,42,0.08)",
      },
      backgroundImage: {
        // 極淡的頁面底：藍白 → 青綠白，維持正文高對比
        "hero-gradient":
          "linear-gradient(160deg, #F2F7FF 0%, #F5F9FB 45%, #EEFBF8 100%)",
        // 藍 → 深青綠，白字對比 ≥ 5:1
        "cta-gradient": "linear-gradient(135deg, #0B5FFF 0%, #0F766E 100%)",
      },
      animation: {
        pulse: "pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
