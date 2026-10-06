import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { quasar, transformAssetUrls } from "@quasar/vite-plugin";
import { defineConfig } from "vitest/config";

const API_TARGET = process.env.MEMTRACE_API_URL ?? "http://localhost:3001";

export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar({ sassVariables: false })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Contrato de la API: solo tipos (se borran al compilar); una única fuente de verdad (ADR-009)
      "@contract": fileURLToPath(new URL("../api/src/adapters/inbound/http/contract.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // El dashboard y la API comparten origen: sin CORS (ADR-009)
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
  preview: { port: 5173, proxy: { "/api": { target: API_TARGET, changeOrigin: true } } },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"], css: false, setupFiles: ["tests/setup.ts"] },
});
