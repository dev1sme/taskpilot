#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildApp } from "./app.js";
import { loadDotEnv } from "./dotenv.js";
import { tasksRoot } from "./repo/tasks.js";
import { newToken } from "./security.js";
import { StateStore } from "./state.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/index.js and server/src/index.ts (tsx) both sit two levels below the app root.
// The app's .env, not the cwd's: taskpilot is usually started inside another repo.
loadDotEnv(path.resolve(here, "../../.env"));

const USAGE = `Usage: taskpilot [--repo <path>] [--host <addr>] [--port <n>] [--open]

  --repo <path>  Repo with .claude/tasks. Default: the current directory if it has
                 .claude/tasks, else the last repo opened.
  --host <addr>  Listen address (default 127.0.0.1, or $TASKPILOT_HOST).
  --port <n>     Port (default 8790, or $TASKPILOT_PORT).
  --open         Open the browser.

Environment: TASKPILOT_HOME (state dir, default ~/.taskpilot), TASKPILOT_TOKEN (fixed UI token),
TASKPILOT_ALLOWED_HOSTS (comma-separated hostnames accepted besides loopback, e.g. a reverse
proxy's domain), TASKPILOT_CLAUDE (claude command, default "claude").
Variables not set in the environment are read from the .env next to package.json.`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      repo: { type: "string" },
      host: { type: "string", default: process.env.TASKPILOT_HOST ?? "127.0.0.1" },
      port: { type: "string", default: process.env.TASKPILOT_PORT ?? "8790" },
      open: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  }));
} catch (e) {
  console.error(`${(e as Error).message}\n\n${USAGE}`);
  process.exit(2);
}
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${values.port}`);
  process.exit(2);
}

const repo = values.repo ?? (existsSync(tasksRoot(process.cwd())) ? process.cwd() : undefined);

// dist/server/index.js -> dist/client ; server/src/index.ts (tsx) -> dist/client
const clientDir = [path.resolve(here, "../client"), path.resolve(here, "../../dist/client")].find((d) => existsSync(d));

const host = values.host;
const allowedHosts = [host, ...(process.env.TASKPILOT_ALLOWED_HOSTS ?? "").split(",")];
const token = process.env.TASKPILOT_TOKEN ?? newToken();
const app = await buildApp({ token, state: new StateStore(), repo, clientDir, logger: true, allowedHosts });

try {
  await app.listen({ host, port });
} catch (e) {
  const code = (e as NodeJS.ErrnoException).code;
  console.error(code === "EADDRINUSE" ? `Port ${port} is in use; pick another with --port.` : (e as Error).message);
  await app.close();
  process.exit(1);
}

const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}/?token=${token}`;
console.log(`\nTaskPilot: ${url}\n`);
if (!clientDir) console.log("Client assets not built; run `npm run dev:client` or `npm run build`.");
if (values.open) openBrowser(url);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}

function openBrowser(target: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log("Could not open a browser; open the URL above."));
  child.unref();
}
