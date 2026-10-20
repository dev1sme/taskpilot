import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = Number(process.env.TASKPILOT_PORT ?? 8790);

export default defineConfig({
  root: "client",
  plugins: [react()],
  // xterm.js alone is ~400 kB; the app is served locally, so one chunk is fine.
  build: { outDir: "../dist/client", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": { target: `http://127.0.0.1:${serverPort}`, ws: true } },
  },
});
