/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // One Latin face, five script faces, all self-hosted. The browser picks
        // per glyph, and the unicode-range blocks in fonts.css mean a Hindi
        // reader never downloads Tamil or Malayalam.
        sans: [
          "Inter",
          "Noto Sans Devanagari",
          "Noto Sans Bengali",
          "Noto Sans Telugu",
          "Noto Sans Tamil",
          "Noto Sans Malayalam",
          "system-ui",
          "sans-serif",
        ],
        // Headings keep Inter: a second display face was 40 kB of download for
        // a distinction most readers never noticed.
        display: [
          "Inter",
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
        // Semantic layer. New components should reach for these, not for a
        // numbered grey: `text-ink-muted` follows the theme, tokens.json and
        // the contrast gate, while `text-gray-500` is a fixed hex that can
        // silently fail contrast in one of the three themes.
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          sunken: "var(--color-surface-sunken)",
        },
        ink: {
          DEFAULT: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
        },
        line: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
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
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      minHeight: {
        tap: "var(--tap-min)",
      },
      minWidth: {
        tap: "var(--tap-min)",
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
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.9) translateY(6px)" },
          "70%": { transform: "scale(1.02) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.2s ease-out both",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.8s linear infinite",
        "pulse-soft": "pulse-soft 2.2s ease-in-out infinite",
        "pop-in": "pop-in 0.2s cubic-bezier(0.2, 0.8, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
