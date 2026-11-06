import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// HTTPS is enabled automatically when a dev certificate exists in
// frontend/.certs/ (self-signed; see README for `make-cert` steps). Phones
// need HTTPS for microphone access (getUserMedia), which is why the voice
// features only work over https:// or on desktop localhost.
// Set SHRAM_HTTPS=off to force plain HTTP (e.g. for the desktop preview tab).
const certDir = path.resolve(__dirname, ".certs");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");
const httpsDisabled = process.env.SHRAM_HTTPS === "off";
const https =
  !httpsDisabled && fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the framework out of the page chunks. React, the router and the
        // i18n runtime change on a dependency bump, not on a page edit, so
        // keeping them in their own long-lived chunk means a content change does
        // not invalidate 200 kB of framework for returning visitors.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
              id,
            )
          ) {
            return "react-vendor";
          }
          if (
            /[\\/]node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector|http-negotiator)[\\/]/.test(
              id,
            )
          ) {
            return "i18n-vendor";
          }
          // axios and nothing else. It is on the startup path (the auth context
          // reads the stored token through api/client), so it needs its own
          // chunk. Everything else used to be lumped in here too -- lucide's
          // icon set, idb, qrcode, workbox -- and because Vite modulepreloads the
          // whole chunk, the language screen downloaded ~88 kB of libraries it
          // never calls. Those are left to Rollup, which puts them in the page
          // chunk that actually uses them.
          if (/[\\/]node_modules[\\/]axios[\\/]/.test(id)) {
            return "http-vendor";
          }
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom", "react-i18next", "i18next"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    https,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    https,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
