import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 暖砂配色：陶土主色（按鈕底／選中態）
        primary: {
          DEFAULT: "#B0522E",
          dark: "#99461F",
        },
        // 暖砂中性：取代原本青綠強調色，用於次要邊框點綴
        accent: {
          DEFAULT: "#EBE4DD",
          dark: "#D8CFC5",
        },
        price: "#9A4620",
        warning: { DEFAULT: "#B45309", bg: "#FEF3C7" },
        surface: { DEFAULT: "#FFFFFF", bg: "#FDFBF9" },
        // 暖砂語意色：文字、邊框、輸入框底
        ink: "#2B2420",
        muted: "#6B5E54",
        line: { DEFAULT: "#EBE4DD", soft: "#F1ECE6" },
        field: "#FAF6F1",
        "accent-soft": "#F7ECE4",
        green: { DEFAULT: "#55702F", soft: "#EEF2E2" },
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
        card: "0 1px 2px rgba(0,0,0,.04), 0 4px 14px rgba(0,0,0,.05)",
        cardHover: "0 1px 2px rgba(0,0,0,.05), 0 8px 22px rgba(0,0,0,.08)",
        float:
          "0 10px 40px -6px rgba(0,0,0,.16), 0 4px 12px rgba(0,0,0,.06)",
      },
      animation: {
        pulse: "pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
