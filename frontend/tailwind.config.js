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
        // Brick. The palette is drawn from the materials a worker stands in
        // front of: fired brick (#9a3f19), sand (#f7f0e4) and set cement. It
        // replaced an emerald ramp that had nothing to do with the work — see
        // design/tokens.css for the semantic layer and its contrast gate.
        // 600/700 are the light-theme workhorses (buttons, links); 300/400 are
        // their dark-theme counterparts, because brick at 700 is unreadable on
        // a charcoal surface.
        brand: {
          50: "#fdf4ee",
          100: "#fae5d7",
          200: "#f3c9af",
          300: "#e8a47f",
          400: "#d97e50",
          500: "#c25a2c",
          600: "#9a3f19",
          700: "#7e3213",
          800: "#65280f",
          900: "#4e1f0d",
          950: "#38160a",
        },
        // Warm neutrals in place of Tailwind's blue-greys. Cement and sand are
        // the app's greys: same lightness steps as before (so every existing
        // bg-gray-*/text-gray-* keeps its meaning and its contrast) but warm,
        // which is what stops the brick accents from looking pasted on.
        gray: {
          50: "#fbf8f3",
          100: "#f4eee5",
          200: "#e6dccc",
          300: "#d3c5b2",
          400: "#a99580",
          500: "#816f5e",
          600: "#6b5b4b",
          700: "#55483b",
          800: "#3c332b",
          900: "#2a231d",
          950: "#1a1511",
        },
        // The government console was built on Tailwind's cool blue-grey slate,
        // which read as a different product next to the worker app. Same
        // lightness steps, re-cut in cement so both surfaces belong to the same
        // site. Nothing about the console's dark "control room" look changes.
        slate: {
          50: "#f8f5f1",
          100: "#f0e9e0",
          200: "#e2d6c7",
          300: "#cbb9a4",
          400: "#a79079",
          500: "#836e59",
          600: "#665443",
          700: "#4e3f33",
          800: "#3a2f26",
          900: "#29211b",
          950: "#191310",
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
        "glow-brand": "0 0 24px -6px rgba(154, 63, 25, 0.4)",
        "glow-brand-lg": "0 8px 40px -8px rgba(154, 63, 25, 0.45)",
        // Layered, soft "premium SaaS" elevations (Linear/Stripe-style).
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        "card-hover":
          "0 4px 8px -2px rgba(16, 24, 40, 0.04), 0 18px 32px -8px rgba(16, 24, 40, 0.14)",
        lift: "0 2px 4px -2px rgba(16, 24, 40, 0.05), 0 12px 24px -6px rgba(16, 24, 40, 0.1)",
        dock: "0 8px 40px -4px rgba(56, 22, 10, 0.22), 0 2px 8px -2px rgba(56, 22, 10, 0.12)",
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
