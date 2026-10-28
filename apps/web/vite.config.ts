import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverPort = Number(process.env.TASKPILOT_PORT ?? 8790);

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
