import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  base: "/",
  resolve: {
    alias: {
      "@controller": resolve(__dirname, "../src/controller/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "../dist/studio"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4173",
      "/files": "http://localhost:4173",
    },
  },
});
