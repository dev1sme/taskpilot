import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager } from "../../../src/modules/sessions/manager.js";
import { isHookEvent } from "../../../src/modules/sessions/hooks.js";
import type { SessionMetrics } from "../../../src/modules/sessions/transports/types.js";

let dir: string;
let manager: SessionManager;
let server: Server;
let sessionId: string;
const received: Array<{ token: string; event: string; body: Record<string, unknown> }> = [];
const metrics: SessionMetrics[] = [];
const events: string[] = [];
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tpl039-session-"));
  received.length = 0;
  metrics.length = 0;
  events.length = 0;
  server = createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    const event = req.url!.split("/").at(-1)!;
    const token = String(req.headers["x-taskpilot-hook-token"]);
    const body = JSON.parse(text);
    received.push({ event, token, body });
    const ok = isHookEvent(event) && (await manager.handleHook(token, event, body));
    res.writeHead(ok ? 200 : 403).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  manager = new SessionManager(new StateStore(path.join(dir, "state")), {
    hookUrl: () => `http://127.0.0.1:${port}/hook`,
    launchers: { codex: (_id, opts) => ({ file: process.execPath, args: [path.resolve("apps/server/test/helpers/fake-codex.mjs"), ...(opts.resume ? ["resume", opts.nativeId!] : [])] }) },
  });
  manager.on("metrics", (_meta, data) => metrics.push(data));
  manager.on("event", (_meta, event) => events.push(event.type));
  sessionId = (await manager.create(dir, "DEMO-1", { agent: "codex", model: "gpt-6.1-sol" })).id;
  await manager.waitForReady(sessionId, { timeoutMs: 3000 });
});
afterEach(async () => {
  try {
    if (sessionId) await manager.stopAndWait(sessionId, { timeoutMs: 2000 });
  } finally {
    manager?.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
it("pins root identity, rejects child events, dedupes Stop and rotates ownership/token on resume", async () => {
  await writeFile(path.join(dir, ".fake-codex-scenario"), "duplicate");
  manager.paste(sessionId, "small synthetic turn");
  await expect.poll(() => events.filter((x) => x === "turn.completed").length).toBe(1);
  await expect.poll(() => received.filter((x) => x.event === "Stop").length).toBe(2);
  const meta = await manager.get(sessionId);
  expect(meta.nativeId).toBeTruthy();
  expect(meta.model).toBe("gpt-6.1-sol");
  expect(meta.observation?.hooks.state).toBe("available");
  expect(metrics).toHaveLength(1);
  const stop = received.find((r) => r.event === "Stop")!;
  const before = events.length;
  expect(await manager.handleHook(stop.token, "Stop", { ...stop.body, session_id: "child", turn_id: "foreign" })).toBe(false);
  expect((await manager.get(sessionId)).nativeId).toBe(meta.nativeId);
  expect(events).toHaveLength(before);
  await manager.stopAndWait(sessionId);
  expect(await manager.handleHook(stop.token, "Stop", stop.body)).toBe(false);
  await manager.resume(sessionId);
  await manager.waitForReady(sessionId, { timeoutMs: 3000 });
  expect((await manager.get(sessionId)).generation).toBe(meta.generation! + 1);
  expect((await manager.get(sessionId)).observation?.hooks.state).toBe("missing");
  expect(await manager.handleHook(stop.token, "Stop", stop.body)).toBe(false);
  manager.paste(sessionId, "resume synthetic turn");
  await expect.poll(() => metrics.length).toBe(2);
  expect(metrics[1].inputTokens).toBe(120);
  expect((await manager.get(sessionId)).nativeId).toBe(meta.nativeId);
  expect((await manager.get(sessionId)).processOwner?.generation).toBe(meta.generation! + 1);
});
it("reports a missing rollout after identity bind without zero-fill or advancing on Interrupt", async () => {
  await writeFile(path.join(dir, ".fake-codex-scenario"), "missing");
  manager.paste(sessionId, "missing source");
  await expect.poll(() => metrics.length).toBe(1);
  expect(metrics[0]).toMatchObject({ availability: { state: "missing", reason: "file-missing" } });
  expect(metrics[0]).not.toHaveProperty("inputTokens");
  const root = received.find((r) => r.event === "Stop")!;
  expect(await manager.handleHook(root.token, "Stop", { ...root.body, turn_id: "interrupt-turn", hook_event_name: "Interrupt" })).toBe(true);
  expect(events.at(-1)).toBe("turn.interrupted");
  expect(metrics).toHaveLength(1);
});
