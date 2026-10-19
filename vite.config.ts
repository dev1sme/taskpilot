import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = Number(process.env.TASKPILOT_PORT ?? 8790);

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": `http://127.0.0.1:${serverPort}` },
  },
});
