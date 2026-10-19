#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildApp } from "./app.js";
import { newToken } from "./security.js";
import { StateStore } from "./state.js";

const HOST = "127.0.0.1";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    port: { type: "string", default: process.env.TASKPILOT_PORT ?? "8790" },
  },
});

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/index.js -> dist/web ; server/src/index.ts (tsx) -> dist/web
const webDir = [path.resolve(here, "../web"), path.resolve(here, "../../dist/web")].find((d) => existsSync(d));

const token = process.env.TASKPILOT_TOKEN ?? newToken();
const port = Number(values.port);

const app = await buildApp({ token, state: new StateStore(), repo: values.repo, webDir, logger: true });
await app.listen({ host: HOST, port });

console.log(`\nTaskPilot: http://${HOST}:${port}/?token=${token}\n`);
if (!webDir) console.log("Web assets not built; run `npm run dev:web` or `npm run build`.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
