import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0B5FFF",
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
      animation: {
        pulse: "pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
