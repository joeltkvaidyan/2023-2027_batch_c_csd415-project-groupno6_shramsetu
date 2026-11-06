import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest config for the frontend component/unit suite.
 *
 * Deliberately separate from vite.config.ts: the dev server config carries an
 * HTTPS cert lookup, a /api proxy and the PWA plugin, none of which mean
 * anything under jsdom. Reusing that file would drag file-system cert reads
 * into every test run.
 *
 * Tests import { describe, it, expect } from "vitest" explicitly rather than
 * relying on `globals: true`, so the files typecheck under the repo's existing
 * tsconfig (no "vitest/globals" types entry needed) and `npm run build` keeps
 * covering them via tsc -b.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Tailwind is compiled at build time by PostCSS; there is nothing for the
    // DOM assertions to read, and processing it in every test is pure cost.
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
