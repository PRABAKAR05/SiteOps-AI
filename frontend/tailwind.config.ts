import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F5F1",
        surface: "#FFFFFF",
        ink: {
          DEFAULT: "#171C19",
          muted: "#5B635D",
          faint: "#8A918B",
        },
        line: "#E3E0D6",
        brand: {
          50: "#EEF7F4",
          100: "#D8EDE7",
          200: "#B4DBD1",
          300: "#82C1B3",
          400: "#4B9F8E",
          500: "#2A8271",
          600: "#0F766E",
          700: "#0B5C56",
          800: "#0A4A45",
          900: "#093D39",
          950: "#04211F",
        },
        warn: "#B45309",
        danger: "#B42318",
        ok: "#117B4B",
      },
      fontFamily: {
        sans: ["Instrument Sans", "Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(23, 28, 25, 0.04), 0 8px 24px -18px rgba(23, 28, 25, 0.35)",
        lift: "0 18px 40px -24px rgba(9, 61, 57, 0.45)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-600px 0" },
          "100%": { backgroundPosition: "600px 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
