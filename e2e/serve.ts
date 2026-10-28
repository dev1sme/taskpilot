// Starts the isolated app under test: `serve.ts server`, `serve.ts client`, or both with no argument.
// Playwright's webServer uses the first two; `npm run serve` runs both for debugging with playwright-cli.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { BASE_URL, CLIENT_ENV, CLIENT_PORT, ROOT, SERVER_ENV, TMP } from "./env";

const bin = (name: string) => path.join(ROOT, "node_modules/.bin", name);

const targets = {
  server: () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(SERVER_ENV.TASKPILOT_HOME, { recursive: true });
    mkdirSync(SERVER_ENV.TASKPILOT_CLAUDE_HOME, { recursive: true });
    return spawn(bin("tsx"), ["apps/server/src/index.ts"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...SERVER_ENV } });
  },
  client: () =>
    spawn(bin("vite"), ["--port", String(CLIENT_PORT), "--strictPort"], {
      cwd: path.join(ROOT, "apps/web"),
      stdio: "inherit",
      env: { ...process.env, ...CLIENT_ENV },
    }),
};

const arg = process.argv[2];
if (arg !== undefined && !(arg in targets)) {
  console.error(`Unknown target: ${arg} (server | client)`);
  process.exit(2);
}
const children = (arg ? [arg as keyof typeof targets] : (["server", "client"] as const)).map((t) => targets[t]());
if (!arg) console.log(`\nApp under test: ${BASE_URL}\n`);

const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => {
  stop();
  process.exitCode = code ?? 0;
});
