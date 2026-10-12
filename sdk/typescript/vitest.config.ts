import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@memtrace-ai/sdk": fileURLToPath(new URL("./src/index.ts", import.meta.url)) } },
});
