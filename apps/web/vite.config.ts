import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Use the engine's TypeScript source directly in dev/build (no prebuild step).
      "@midi-gateway/engine": fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 4665,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:4666", ws: true },
      "/health": "http://127.0.0.1:4666",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
