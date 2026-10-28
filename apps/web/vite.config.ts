import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverPort = Number(process.env.TASKPILOT_PORT ?? 8790);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace deps live in the root node_modules; keep Vite's cache there too, not in apps/web.
  cacheDir: path.resolve(import.meta.dirname, "../../node_modules/.vite/web"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  // xterm.js alone is ~400 kB; the app is served locally, so one chunk is fine.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": { target: `http://127.0.0.1:${serverPort}`, ws: true } },
  },
});
