import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { codexLauncher } from "../../src/providers/codex/cli-launcher.js";
import type { Launcher } from "../../src/core/launch.js";
import type { HookEvent, SessionManager } from "../../src/modules/sessions/index.js";

/** fake-codex.mjs: `app-server` in argv is the probe's app-server, anything else the TUI stand-in. */
export const FAKE_CODEX = path.resolve(import.meta.dirname, "fake-codex.mjs");

/**
 * The real Codex launcher with the stand-in in place of the binary: the stand-in gets the arguments Codex would
 * get (`resume <id>`, `-m`, `-c hooks.*`, …) and the environment of the real launch. `env` may be a live object;
 * it is read at each launch, so a test can change a fault between launches. `FAKE_CODEX_LAUNCH_FAIL` makes the
 * launcher itself throw, as it does for a Codex it cannot start (the error reaches whoever spawns the session).
 */
export function codexTuiLauncher(env: Record<string, string> = {}): Launcher {
  return (sessionId, opts) => {
    if (env.FAKE_CODEX_LAUNCH_FAIL) throw new Error(env.FAKE_CODEX_LAUNCH_FAIL);
    const spec = codexLauncher(sessionId, opts);
    return { file: process.execPath, args: [FAKE_CODEX, ...spec.args], env: { ...spec.env, ...env } };
  };
}

export interface HookServer {
  /** For `SessionManager`'s `hookUrl` option. */
  url: () => string | null;
  /** Hooks of the stand-in reach this manager, as TaskPilot's /hook routes pass them on. */
  attach: (manager: SessionManager) => void;
  close: () => Promise<void>;
}

/** A local HTTP port the stand-in's hook commands post to; use when the test builds its own SessionManager. */
export async function startHookServer(): Promise<HookServer> {
  let sessions: SessionManager | undefined;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const event = (req.url ?? "").split("/").pop() as HookEvent;
      const token = req.headers["x-taskpilot-hook-token"];
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
      void (sessions?.handleHook(typeof token === "string" ? token : "", event, payload) ?? Promise.resolve(false)).finally(() => res.end());
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as { port: number };
  return {
    url: () => `http://127.0.0.1:${port}/hook`,
    attach: (manager) => {
      sessions = manager;
    },
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** A thread the stand-in can `resume`, as if a Codex run in `repo` had already created it. */
export async function seedCodexThread(repo: string, threadId: string): Promise<void> {
  const dir = path.join(repo, ".fake-codex-threads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${threadId}.json`), JSON.stringify({ lastText: "", model: "gpt-6.1-sol", usage: { input: 0, output: 0 } }));
}
