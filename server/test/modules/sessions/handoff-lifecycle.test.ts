import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { Launcher } from "../../../src/core/claude/launch.js";
import { StateStore, type AppState } from "../../../src/core/state.js";
import type { RepoContext } from "../../../src/modules/repo/index.js";
import { SessionManager, registerSessionsRoutes, type ConversationItem } from "../../../src/modules/sessions/index.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const FAKE = path.resolve(import.meta.dirname, "../../helpers/fake-codex.mjs");
const managers: SessionManager[] = [];
const apps: ReturnType<typeof Fastify>[] = [];
const echo: Launcher = () => ({ file: "/bin/sh", args: ["-c", 'echo ready; while read -r line; do echo "got:$line"; done'] });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const manager of managers.splice(0)) manager.closeAll();
});
afterAll(cleanupTempDirs);

class Socket extends EventEmitter {
  readyState = 1;
  OPEN = 1;
  frames: Array<{ t: string; d?: string; item?: ConversationItem; items?: ConversationItem[] }> = [];
  send(data: string) {
    this.frames.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  get output() {
    return this.frames.map((f) => f.d ?? "").join("");
  }
  get items() {
    const items = new Map<string, ConversationItem>();
    for (const f of this.frames) {
      for (const i of f.items ?? []) items.set(i.id, i);
      if (f.item) items.set(f.item.id, f.item);
    }
    return [...items.values()];
  }
  input(text: string) {
    this.emit("message", JSON.stringify({ t: "i", d: text }));
  }
  resize() {
    this.emit("message", JSON.stringify({ t: "r", cols: 80, rows: 24 }));
  }
}
async function setup(env: Record<string, string> = {}) {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("handoff-lifecycle-"));
  const codex: Launcher = () => ({ file: process.execPath, args: [FAKE], env });
  const manager = new SessionManager(state, { launcher: echo, launchers: { codex } });
  managers.push(manager);
  return { manager, state, repo, codex };
}
function token(manager: SessionManager, id: string) {
  return (manager as unknown as { live: Map<string, { hookToken: string }> }).live.get(id)!.hookToken;
}
async function api(manager: SessionManager, repo: string) {
  const app = Fastify();
  apps.push(app);
  await app.register(websocket);
  registerSessionsRoutes(app, { sessions: manager, repo: { require: () => repo } as RepoContext, runs: { usesSession: async () => false } });
  app.setErrorHandler((error, _request, reply) => reply.code((error as { status?: number }).status ?? 500).send({ error: (error as Error).message }));
  return app;
}

describe("session handoff lifecycle", () => {
  it("persists the reserved id and journal callback before starting a fresh native thread", async () => {
    const { manager, state, repo } = await setup();
    let recordedId = "";
    const created = await manager.create(repo, "DEMO-1", {
      agent: "codex",
      operationId: "transfer-1",
      beforeSpawn: async (session) => {
        recordedId = session.id;
        const durable = await new StateStore(state.dir).load();
        expect(durable.sessions).toMatchObject([{ id: recordedId, reservation: { operationId: "transfer-1", role: "target" } }]);
        expect(durable.sessions[0].processOwner).toBeUndefined();
        expect(durable.sessions[0].nativeId).toBeUndefined();
        await expect(manager.resume(recordedId)).rejects.toMatchObject({ status: 409 });
      },
    });
    expect(created.id).toBe(recordedId);
    expect(created.nativeId).toBeTruthy();
    expect(created.generation).toBe(1);
    expect((await manager.waitForReady(created.id)).id).toBe(recordedId);
    expect(() => manager.paste(created.id, "not committed")).toThrow();
    await manager.release(created.id, "transfer-1");
    manager.paste(created.id, "hello");
    await manager.stopAndWait(created.id);
  });

  it("does not spawn when registering the id in the journal fails", async () => {
    const { manager, state, repo } = await setup();
    await expect(
      manager.create(repo, "DEMO-1", {
        agent: "codex",
        operationId: "journal-failure",
        beforeSpawn: async () => {
          throw new Error("journal disk full");
        },
      }),
    ).rejects.toThrow("journal disk full");
    const [target] = (await new StateStore(state.dir).load()).sessions;
    expect(target.reservation?.operationId).toBe("journal-failure");
    expect(target.processOwner).toBeUndefined();
    expect(target.nativeId).toBeUndefined();
    await expect(manager.resume(target.id)).rejects.toMatchObject({ status: 409 });
  });

  it("holds one durable reservation, rejects competitors and keeps the lock across reload", async () => {
    const { manager, state, repo } = await setup();
    const session = await manager.create(repo, "DEMO-1");
    const results = await Promise.allSettled([manager.reserve(session.id, "first"), manager.reserve(session.id, "second")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const current = await manager.get(session.id);
    const operationId = current.reservation!.operationId;
    await manager.reserve(session.id, operationId);
    await expect(manager.reserve(session.id, operationId, "target")).rejects.toMatchObject({ status: 409 });
    await expect(manager.release(session.id, "wrong")).rejects.toMatchObject({ status: 409 });
    expect(() => manager.paste(session.id, "blocked")).toThrow();
    const next = new SessionManager(new StateStore(state.dir));
    managers.push(next);
    await expect(next.resume(session.id)).rejects.toMatchObject({ status: 409 });
    await expect(manager.forget(session.id)).rejects.toMatchObject({ status: 409 });
    await manager.stopAndWait(session.id);
    await manager.release(session.id, operationId);
    expect((await manager.resume(session.id)).generation).toBe(2);
  });

  it("keeps a failed durable unlock locked in memory and on disk", async () => {
    const { manager, state, repo } = await setup();
    const session = await manager.create(repo, "DEMO-1");
    await manager.reserve(session.id, "disk-error");
    const writable = state as unknown as { write(state: AppState): Promise<void> };
    vi.spyOn(writable, "write").mockRejectedValueOnce(new Error("disk full"));
    await expect(manager.release(session.id, "disk-error")).rejects.toThrow("disk full");
    expect(() => manager.paste(session.id, "unsafe")).toThrow();
    expect((await manager.get(session.id)).reservation?.operationId).toBe("disk-error");
    expect((await new StateStore(state.dir).load()).sessions[0].reservation?.operationId).toBe("disk-error");
    await manager.stopAndWait(session.id);
  });

  it("waits for an actual PTY SessionStart and rejects ready after exit", async () => {
    const { manager, repo } = await setup();
    const session = await manager.create(repo, "DEMO-1");
    await expect(manager.waitForReady(session.id, { timeoutMs: 20 })).rejects.toMatchObject({ status: 409 });
    const ready = manager.waitForReady(session.id);
    expect(await manager.handleHook(token(manager, session.id), "SessionStart", { session_id: session.id })).toBe(true);
    expect((await ready).activity).toBe("idle");
    const oldToken = token(manager, session.id);
    await manager.stopAndWait(session.id);
    await expect(manager.waitForReady(session.id)).rejects.toMatchObject({ status: 409 });
    expect(await manager.handleHook(oldToken, "Stop", {})).toBe(false);
  });

  it("blocks REST input, approvals, interrupts and resume while reserved and retired", async () => {
    const { manager, repo } = await setup();
    const source = await manager.create(repo, "DEMO-1", { agent: "codex" });
    const app = await api(manager, repo);
    await manager.reserve(source.id, "rest");
    const requests = [
      { url: `/api/sessions/${source.id}/resume` },
      { url: `/api/sessions/${source.id}/input`, payload: { text: "unsafe" } },
      { url: `/api/sessions/${source.id}/approvals/0`, payload: { decision: "accept" } },
      { url: `/api/sessions/${source.id}/interrupt` },
    ];
    for (const req of requests) expect((await app.inject({ method: "POST", ...req })).statusCode).toBe(409);
    const target = await manager.create(repo, "DEMO-1", { agent: "codex", operationId: "rest" });
    expect(target.nativeId).not.toBe(source.nativeId);
    await manager.stopAndWait(source.id);
    await manager.retire(source.id, "rest", target.id);
    for (const req of requests) expect((await app.inject({ method: "POST", ...req })).statusCode).toBe(409);
    expect(await manager.list(repo, "DEMO-1")).toHaveLength(2);
    const socket = new Socket();
    await manager.attachConversation(source.id, socket as unknown as WebSocket);
    expect(socket.frames.some((f) => f.t === "items")).toBe(true);
    await manager.release(target.id, "rest");
    await manager.stopAndWait(target.id);
  });

  it("checks each PTY input frame on an already open socket and still replays history", async () => {
    const { manager, repo } = await setup();
    const source = await manager.create(repo, "DEMO-1");
    const socket = new Socket();
    await manager.attach(source.id, socket as unknown as WebSocket);
    socket.resize();
    socket.input("before\r");
    await vi.waitFor(() => expect(socket.output).toContain("got:before"));
    await manager.reserve(source.id, "ws");
    socket.input("blocked-reserved\r");
    const target = await manager.create(repo, "DEMO-1", { operationId: "ws" });
    await manager.stopAndWait(source.id);
    await manager.retire(source.id, "ws", target.id);
    socket.input("blocked-retired\r");
    const second = new Socket();
    await manager.attach(source.id, second as unknown as WebSocket);
    second.resize();
    expect(second.output).toContain("got:before");
    expect(second.output).not.toContain("blocked-reserved");
    expect(second.output).not.toContain("blocked-retired");
    await expect(manager.resume(source.id)).rejects.toMatchObject({ status: 409 });
    await manager.stopAndWait(target.id);
  });

  it("waits for delayed process exit after stdout closes without waiting for the engine queue", async () => {
    const dir = await tempDir("delayed-exit-");
    const log = path.join(dir, "exit.log");
    const { manager, repo } = await setup({ FAKE_CODEX_EXIT_DELAY_MS: "250", FAKE_CODEX_CLOSE_STDOUT_ON_STOP: "1", FAKE_CODEX_EXIT_LOG: log });
    const source = await manager.create(repo, "DEMO-1", { agent: "codex" });
    let engineFinished = false;
    let exitProcessed = false;
    let queue = Promise.resolve();
    manager.on("exit", () => {
      queue = queue.then(() => {
        exitProcessed = true;
      });
    });
    queue = queue.then(async () => {
      await manager.stopAndWait(source.id);
      engineFinished = true;
    });
    await vi.waitFor(async () => expect(await readFile(log, "utf8")).toContain("stop"));
    expect(engineFinished).toBe(false);
    expect((await manager.get(source.id)).status).toBe("running");
    await vi.waitFor(() => expect(exitProcessed).toBe(true));
    expect(engineFinished).toBe(true);
    expect(await readFile(log, "utf8")).toContain("exit");
    expect((await manager.get(source.id)).processOwner).toBeUndefined();
  });

  it("keeps the reservation when stop times out, then allows an explicit retry", async () => {
    const { manager, repo } = await setup({ FAKE_CODEX_EXIT_DELAY_MS: "250" });
    const source = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.reserve(source.id, "timeout");
    await expect(manager.stopAndWait(source.id, { timeoutMs: 25 })).rejects.toMatchObject({ status: 409 });
    expect((await manager.get(source.id)).reservation?.operationId).toBe("timeout");
    expect(await manager.list(repo, "DEMO-1")).toHaveLength(1);
    await expect(manager.resume(source.id)).rejects.toMatchObject({ status: 409 });
    await manager.stopAndWait(source.id);
  });

  it.runIf(process.platform === "linux").each([false, true])("does not pass the barrier while a tool child survives its parent (detached=%s)", async (detached) => {
    const dir = await tempDir("child-exit-");
    const file = path.join(dir, "child.pid");
    const { manager, repo } = await setup({ FAKE_CODEX_CHILD_DELAY_MS: "350", FAKE_CODEX_CHILD_FILE: file, ...(detached ? { FAKE_CODEX_CHILD_DETACHED: "1" } : {}) });
    const source = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await vi.waitFor(async () => expect(Number(await readFile(file, "utf8"))).toBeGreaterThan(0));
    const barrier = manager.stopAndWait(source.id);
    await vi.waitFor(async () => expect((await manager.get(source.id)).status).toBe("exited"));
    await expect(manager.resume(source.id)).rejects.toMatchObject({ status: 409 });
    await expect(manager.waitForExit(source.id, { timeoutMs: 25 })).rejects.toMatchObject({ status: 409 });
    await barrier;
    expect((await manager.get(source.id)).processOwner).toBeUndefined();
  });

  it("keeps source locked after rollback timeout, then retires target before unlocking source", async () => {
    const { manager, repo } = await setup({ FAKE_CODEX_EXIT_DELAY_MS: "250" });
    const source = await manager.create(repo, "DEMO-1");
    await manager.reserve(source.id, "rollback");
    await manager.stopAndWait(source.id);
    const target = await manager.create(repo, "DEMO-1", { agent: "codex", operationId: "rollback" });
    await expect(manager.rollback(source.id, target.id, "rollback", { timeoutMs: 25 })).rejects.toMatchObject({ status: 409 });
    expect((await manager.get(source.id)).reservation).toBeTruthy();
    expect((await manager.get(target.id)).reservation).toBeTruthy();
    await manager.rollback(source.id, target.id, "rollback");
    expect((await manager.get(source.id)).reservation).toBeUndefined();
    expect((await manager.get(source.id)).status).toBe("exited");
    expect((await manager.get(target.id)).retired?.replacedBy).toBe(source.id);
    await expect(manager.resume(target.id)).rejects.toMatchObject({ status: 409 });
    expect((await manager.resume(source.id)).generation).toBe(2);
  });

  it.runIf(process.platform === "linux")("recovers an owned surviving group after reload without launching a thread", async () => {
    const { manager, state, repo, codex } = await setup();
    const source = await manager.create(repo, "DEMO-1", { agent: "codex" });
    const next = new SessionManager(new StateStore(state.dir), { launchers: { codex } });
    managers.push(next);
    await next.reserve(source.id, "recovery");
    await next.recoverProcess(source.id);
    expect((await next.get(source.id)).processOwner).toBeUndefined();
    expect((await next.get(source.id)).nativeId).toBe(source.nativeId);
    await next.release(source.id, "recovery");
    const resumed = await next.resume(source.id);
    expect(resumed.nativeId).toBe(source.nativeId);
    expect(resumed.generation).toBe(2);
    await next.stopAndWait(source.id);
  });

  it.runIf(process.platform === "linux")("discovers a process in the crash window before ownership was persisted", async () => {
    const { manager, state, repo } = await setup();
    const source = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await state.update((s) => {
      delete s.sessions[0].processOwner;
    });
    const next = new SessionManager(new StateStore(state.dir));
    managers.push(next);
    await next.recoverProcess(source.id);
    expect((await next.get(source.id)).exitedGeneration).toBe(1);
    await vi.waitFor(async () => expect((await manager.get(source.id)).status).toBe("exited"));
  });

  it.runIf(process.platform === "linux")("refuses to signal an unrelated PID or an owner without verifiable identity", async () => {
    const { manager, state, repo } = await setup();
    for (const identity of [undefined, "unrelated-boot:42"]) {
      const source = await manager.create(repo, "DEMO-1");
      await manager.stopAndWait(source.id);
      await state.update((s) => {
        s.sessions.find((x) => x.id === source.id)!.processOwner = { pid: process.pid, startedAt: Date.now(), generation: 1, ...(identity ? { identity } : {}) };
      });
      await expect(manager.recoverProcess(source.id)).rejects.toMatchObject({ status: 409 });
      expect((await manager.get(source.id)).processOwner?.pid).toBe(process.pid);
      await state.update((s) => {
        delete s.sessions.find((x) => x.id === source.id)!.processOwner;
      });
    }
  });

  it("cannot spawn after stop while the pre-spawn journal callback is pending", async () => {
    const { manager, repo } = await setup();
    let unblock!: () => void;
    let registered!: (id: string) => void;
    const registeredId = new Promise<string>((resolve) => (registered = resolve));
    const gate = new Promise<void>((resolve) => (unblock = resolve));
    const creation = manager.create(repo, "DEMO-1", {
      agent: "codex",
      operationId: "pending-journal",
      beforeSpawn: async (target) => {
        registered(target.id);
        await gate;
      },
    });
    const failed = creation.catch((error: unknown) => error);
    const id = await registeredId;
    await expect(manager.stopAndWait(id, { timeoutMs: 20 })).rejects.toMatchObject({ status: 409 });
    unblock();
    expect(await failed).toMatchObject({ status: 409 });
    await manager.stopAndWait(id);
    const target = await manager.get(id);
    expect(target.processOwner).toBeUndefined();
    expect(target.nativeId).toBeUndefined();
    expect(target.generation).toBeUndefined();
  });

  it("stops startup while environment preparation is pending and rejects a competing resume", async () => {
    const repo = await makeRepo();
    const state = new StateStore(await tempDir("pending-start-"));
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => (unblock = resolve));
    const launch = vi.fn(echo);
    const manager = new SessionManager(state, {
      launcher: launch,
      extraEnv: async () => {
        await gate;
        return {};
      },
    });
    managers.push(manager);
    const pending = manager.create(repo, "DEMO-1");
    const failed = expect(pending).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(async () => expect((await manager.list(repo, "DEMO-1"))[0]?.generation).toBe(1));
    const [source] = await manager.list(repo, "DEMO-1");
    await expect(manager.resume(source.id)).rejects.toMatchObject({ status: 409 });
    await manager.stop(source.id);
    unblock();
    await failed;
    await manager.waitForExit(source.id);
    expect(launch).not.toHaveBeenCalled();
  });
});
