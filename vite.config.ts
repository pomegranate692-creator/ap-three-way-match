import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web client is a pure static SPA. All secrets and AI calls live on the server.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8791", changeOrigin: false } },
  },
});
