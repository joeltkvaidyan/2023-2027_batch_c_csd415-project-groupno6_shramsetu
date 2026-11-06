/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans",
          "Noto Sans Devanagari",
          "Noto Sans Bengali",
          "Noto Sans Telugu",
          "Noto Sans Tamil",
          "Noto Sans Malayalam",
          "system-ui",
          "sans-serif",
        ],
        // Display face for headings/hero numerals — sharper, more editorial.
        display: [
          "Plus Jakarta Sans",
          "Inter",
          "Noto Sans",
          "Noto Sans Devanagari",
          "Noto Sans Bengali",
          "Noto Sans Telugu",
          "Noto Sans Tamil",
          "Noto Sans Malayalam",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        // Warm gold accent — used sparingly for "premium" moments
        // (featured tiles, hero highlights, verified marks).
        gold: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
        },
      },
      boxShadow: {
        "glow-brand": "0 0 24px -6px rgba(16, 185, 129, 0.45)",
        "glow-brand-lg": "0 8px 40px -8px rgba(16, 185, 129, 0.5)",
        // Layered, soft "premium SaaS" elevations (Linear/Stripe-style).
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        "card-hover":
          "0 4px 8px -2px rgba(16, 24, 40, 0.04), 0 18px 32px -8px rgba(16, 24, 40, 0.14)",
        lift: "0 2px 4px -2px rgba(16, 24, 40, 0.05), 0 12px 24px -6px rgba(16, 24, 40, 0.1)",
        dock: "0 8px 40px -4px rgba(2, 44, 34, 0.22), 0 2px 8px -2px rgba(2, 44, 34, 0.12)",
        "ring-inner": "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "aurora-shift": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(24px, -18px) scale(1.08)" },
          "66%": { transform: "translate(-18px, 14px) scale(0.95)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.9) translateY(6px)" },
          "70%": { transform: "scale(1.02) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.3s ease-out both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.8s linear infinite",
        float: "float 5s ease-in-out infinite",
        "pulse-soft": "pulse-soft 2.2s ease-in-out infinite",
        "aurora-shift": "aurora-shift 14s ease-in-out infinite",
        "pop-in": "pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      },
    },
  },
  plugins: [],
};
