import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { buildApp } from "../../../src/app.js";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager, type ConversationItem } from "../../../src/modules/sessions/index.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const FAKE = path.resolve(import.meta.dirname, "../../helpers/fake-codex.mjs");
const managers: SessionManager[] = [];
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const manager of managers.splice(0)) manager.closeAll();
});
afterAll(cleanupTempDirs);

class Socket extends EventEmitter {
  readyState = 1;
  frames: Array<{ t: string; item?: ConversationItem; items?: ConversationItem[] }> = [];
  send(raw: string) {
    this.frames.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  get items() {
    const items = new Map<string, ConversationItem>();
    for (const f of this.frames) {
      for (const i of f.items ?? []) items.set(i.id, i);
      if (f.item) items.set(f.item.id, f.item);
    }
    return [...items.values()];
  }
}

async function setup(env: Record<string, string> = {}) {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-session-state-"));
  const manager = new SessionManager(state, { launchers: { codex: () => ({ file: process.execPath, args: [FAKE], env }) } });
  managers.push(manager);
  const hooks: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const metrics: Record<string, unknown>[] = [];
  manager.on("hook", (_meta, event, payload) => hooks.push({ event, payload }));
  manager.on("metrics", (_meta, data) => metrics.push(data));
  const session = await manager.create(repo, "DEMO-1", { agent: "codex", permissionMode: "acceptEdits" });
  const socket = new Socket();
  await manager.attachConversation(session.id, socket as unknown as WebSocket);
  const waitStop = (n = 1) => vi.waitFor(() => expect(hooks.filter((h) => h.event === "Stop")).toHaveLength(n));
  return { repo, state, manager, hooks, metrics, session, socket, waitStop };
}

describe("Codex sessions", () => {
  it("maps recorded file changes, MCP, web search and future tool kinds", async () => {
    const { manager, session, hooks, waitStop } = await setup();
    manager.paste(session.id, "TOOL_TYPES");
    await waitStop();
    expect(hooks.filter((h) => h.event === "PreToolUse").map((h) => h.payload.tool_name)).toEqual(["Edit", "mcp__docs__search", "WebSearch", "futureTool"]);
    expect(hooks.filter((h) => h.event === "PostToolUse")).toHaveLength(4);
  });
  it("uses its own native thread id, sends multiline input, maps recorded tools and reports usage", async () => {
    const { manager, session, socket, hooks, metrics, waitStop } = await setup();
    expect(session.transport).toBe("rpc");
    expect(session.nativeId).toBeTruthy();
    expect(session.nativeId).not.toBe(session.id);
    manager.paste(session.id, "Line one\nLine two");
    await waitStop();
    expect(socket.items.find((i) => i.kind === "user")?.text).toBe("Line one\nLine two");
    expect(hooks.map((h) => h.event)).toEqual(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]);
    expect(hooks.every((h) => h.payload.session_id === session.id)).toBe(true);
    expect(hooks[2].payload).toMatchObject({ tool_name: "Bash" });
    expect(hooks.at(-1)?.payload.last_assistant_message).toBe("DONE");
    expect(metrics).toContainEqual({ inputTokens: 100, outputTokens: 20 });
    expect(manager.hookSeen(session.id)).toBe(true);
    expect((await manager.get(session.id)).activity).toBe("idle");
  });

  it.each(["accept", "decline"] as const)("waits for an explicit %s and rejects stale approval answers", async (decision) => {
    const { manager, session, socket, hooks, waitStop } = await setup();
    manager.paste(session.id, "APPROVAL");
    await vi.waitFor(() => expect(socket.items.some((i) => i.kind === "approval")).toBe(true));
    expect((await manager.get(session.id)).activity).toBe("permission");
    expect(hooks.some((h) => h.event === "Stop")).toBe(false);
    const request = socket.items.find((i) => i.kind === "approval")!;
    expect(request.requestId).toMatch(/:0$/);
    await manager.answer(session.id, request.requestId!, decision);
    await waitStop();
    expect(socket.items.find((i) => i.id === request.id)?.status).toBe(decision === "accept" ? "accepted" : "declined");
    expect(hooks.filter((h) => h.event === "PreToolUse")).toHaveLength(1);
    expect(hooks.at(-1)?.payload.last_assistant_message).toBe(decision === "accept" ? "APPROVED" : "DECLINED");
    await expect(manager.answer(session.id, request.requestId!, "accept")).rejects.toMatchObject({ status: 409 });
  });

  it("interrupts without item/completed, closes open tools, and allows steering without a second turn", async () => {
    const { manager, session, hooks, socket, waitStop } = await setup();
    manager.paste(session.id, "SLOW");
    await vi.waitFor(() => expect(socket.items.some((i) => i.kind === "tool")).toBe(true));
    manager.paste(session.id, "Another line while busy");
    await vi.waitFor(() => expect(socket.items.filter((i) => i.kind === "user")).toHaveLength(2));
    await manager.interrupt(session.id);
    await waitStop();
    expect(hooks.filter((h) => h.event === "UserPromptSubmit")).toHaveLength(1);
    expect(hooks.some((h) => h.event === "PostToolUseFailure")).toBe(true);
    expect(socket.items.find((i) => i.kind === "tool")?.status).toBe("cancelled");
  });

  it("resumes the persisted thread in a new manager after restart", async () => {
    const { manager, session, state, repo, waitStop } = await setup();
    manager.paste(session.id, "PELICAN-42");
    await waitStop();
    await manager.stop(session.id);
    await vi.waitFor(async () => expect((await manager.get(session.id)).status).toBe("exited"));
    const next = new SessionManager(new StateStore(state.dir), { launchers: { codex: () => ({ file: process.execPath, args: [FAKE] }) } });
    managers.push(next);
    const socket = new Socket();
    await next.attachConversation(session.id, socket as unknown as WebSocket);
    const resumed = await next.resume(session.id);
    expect(resumed.nativeId).toBe(session.nativeId);
    next.paste(session.id, "RECALL");
    await vi.waitFor(() => expect(socket.items.some((i) => i.kind === "agent" && i.text === "PELICAN-42")).toBe(true));
    expect(await next.list(repo, "DEMO-1")).toHaveLength(1);
  });

  it("refuses resume without a native id, unsupported permissions, subagents and unavailable models", async () => {
    const { manager, state, session, repo } = await setup();
    await manager.stop(session.id);
    await vi.waitFor(async () => expect((await manager.get(session.id)).status).toBe("exited"));
    await state.update((s) => {
      delete s.sessions[0].nativeId;
    });
    await expect(manager.resume(session.id)).rejects.toMatchObject({ status: 409 });
    for (const options of [{ permissionMode: "plan" }, { subagent: "reviewer" }, { model: "missing-model" }]) {
      await expect(manager.create(repo, "DEMO-1", { agent: "codex", ...options })).rejects.toMatchObject({ status: 400 });
    }
  });

  it.each(["RETRY", "RPC_FAIL", "FAIL_TURN", "UNSUPPORTED"])("handles %s without hanging or duplicate Stop", async (prompt) => {
    const { manager, session, hooks, waitStop, socket } = await setup();
    manager.paste(session.id, prompt);
    await waitStop();
    expect(hooks.filter((h) => h.event === "Stop")).toHaveLength(1);
    expect((await manager.get(session.id)).activity).toBe("idle");
    expect(socket.items.some((i) => i.kind === "error")).toBe(true);
  });

  it("cancels pending approvals on stop and replays them as cancelled", async () => {
    const { manager, session, socket } = await setup();
    manager.paste(session.id, "APPROVAL");
    await vi.waitFor(() => expect(socket.items.some((i) => i.status === "pending")).toBe(true));
    await manager.stop(session.id);
    expect(socket.items.find((i) => i.kind === "approval")?.status).toBe("cancelled");
  });

  it("cancels approval on transfer stop, ignores late completion and rejects the old answer after resume", async () => {
    const log = path.join(await tempDir("approval-cancel-"), "rpc.log");
    const { manager, session, socket, hooks } = await setup({ FAKE_CODEX_EXIT_DELAY_MS: "200", FAKE_CODEX_LOG: log });
    manager.paste(session.id, "APPROVAL");
    await vi.waitFor(() => expect(socket.items.some((i) => i.status === "pending")).toBe(true));
    const oldRequest = socket.items.find((i) => i.status === "pending")!.requestId!;
    await manager.reserve(session.id, "cancel-approval");
    await expect(manager.answer(session.id, oldRequest, "accept")).rejects.toMatchObject({ status: 409 });
    await manager.stop(session.id);
    expect(socket.items.find((i) => i.kind === "approval")?.status).toBe("cancelled");
    await vi.waitFor(async () => expect(await readFile(log, "utf8")).toContain('"decision":"cancel"'));
    await manager.waitForExit(session.id);
    expect(hooks.filter((h) => h.event === "Stop")).toHaveLength(0);
    await manager.release(session.id, "cancel-approval");
    const resumed = await manager.resume(session.id);
    expect(resumed.nativeId).toBe(session.nativeId);
    manager.paste(session.id, "APPROVAL");
    await vi.waitFor(() => expect(socket.items.some((i) => i.status === "pending")).toBe(true));
    const nextRequest = socket.items.find((i) => i.status === "pending")!.requestId!;
    expect(nextRequest).not.toBe(oldRequest);
    await expect(manager.answer(session.id, oldRequest, "accept")).rejects.toMatchObject({ status: 409 });
    await manager.stopAndWait(session.id);
  });

  it("cannot become ready from a delayed thread response after stop during startup", async () => {
    const state = new StateStore(await tempDir("codex-stop-startup-"));
    const manager = new SessionManager(state, {
      launchers: { codex: () => ({ file: process.execPath, args: [FAKE], env: { FAKE_CODEX_THREAD_DELAY_MS: "150", FAKE_CODEX_EXIT_DELAY_MS: "250" } }) },
    });
    managers.push(manager);
    const hooks: string[] = [];
    manager.on("hook", (_meta, event) => hooks.push(event));
    const pending = manager.create(await makeRepo(), "DEMO-1", { agent: "codex" });
    const failed = pending.catch((error: unknown) => error);
    await vi.waitFor(async () => expect((await state.load()).sessions[0]?.processOwner).toBeTruthy());
    const id = (await state.load()).sessions[0].id;
    await manager.stopAndWait(id);
    expect(await failed).toMatchObject({ status: 409 });
    expect(hooks).not.toContain("SessionStart");
    await expect(manager.waitForReady(id)).rejects.toMatchObject({ status: 409 });
    expect((await manager.get(id)).status).toBe("exited");
  });

  it("rolls a failed target startup back only after its delayed process cleanup", async () => {
    const { manager, session, repo, state } = await setup({ FAKE_CODEX_EXIT_DELAY_MS: "200" });
    await manager.reserve(session.id, "failed-startup");
    await manager.stopAndWait(session.id);
    let targetId = "";
    await expect(
      manager.create(repo, "DEMO-1", {
        agent: "codex",
        model: "missing-model",
        operationId: "failed-startup",
        beforeSpawn: async (target) => {
          targetId = target.id;
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(manager.rollback(session.id, targetId, "failed-startup", { timeoutMs: 20 })).rejects.toMatchObject({ status: 409 });
    expect((await manager.get(session.id)).reservation).toBeTruthy();
    await manager.rollback(session.id, targetId, "failed-startup");
    expect((await manager.get(targetId)).retired?.replacedBy).toBe(session.id);
    expect((await new StateStore(state.dir).load()).sessions.find((s) => s.id === session.id)?.reservation).toBeUndefined();
    expect((await manager.resume(session.id)).nativeId).toBe(session.nativeId);
    await manager.stopAndWait(session.id);
  });

  it("reports missing CLI, logged out accounts and incompatible protocol", async () => {
    for (const [env, text] of [
      [{ FAKE_CODEX_LOGGED_OUT: "1" }, "chưa đăng nhập"],
      [{ FAKE_CODEX_PROTOCOL: "1" }, "không tương thích"],
    ] as const) {
      await expect(setup(env)).rejects.toThrow(text);
    }
    const state = new StateStore(await tempDir("codex-missing-"));
    const manager = new SessionManager(state, { launchers: { codex: () => ({ file: "/no/such/codex", args: [] }) } });
    managers.push(manager);
    await expect(manager.create(await makeRepo(), "DEMO-1", { agent: "codex" })).rejects.toThrow("Không tìm thấy Codex");
  });

  it("exposes authenticated input/interrupt/approval routes and rejects PTY sessions", async () => {
    const state = new StateStore(await tempDir("codex-api-"));
    const app = await buildApp({ state, token: "test", repo: await makeRepo(), launchers: { codex: () => ({ file: process.execPath, args: [FAKE] }) } });
    apps.push(app);
    const headers = { host: "127.0.0.1:8790", "x-taskpilot-token": "test" };
    const session = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers, payload: { agent: "codex" } })).json();
    expect(session.transport).toBe("rpc");
    expect((await app.inject({ method: "POST", url: `/api/sessions/${session.id}/input`, payload: { text: "hello" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/sessions/${session.id}/input`, headers, payload: { text: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/sessions/${session.id}/input`, headers, payload: { text: "hello\nworld" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/sessions/${session.id}/approvals/0`, headers, payload: { decision: "acceptForSession" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/sessions/${session.id}/approvals/stale`, headers, payload: { decision: "accept" } })).statusCode).toBe(409);
    await vi.waitFor(async () => {
      const activity = (await app.inject({ url: "/api/tasks/DEMO-1/activity", headers })).json();
      expect(activity.some((i: { kind: string }) => i.kind === "stop")).toBe(true);
    });
  });

  it("reports account rate limits on ready and when Codex updates them, and survives a Codex without them", async () => {
    const state = new StateStore(await tempDir("codex-usage-"));
    const app = await buildApp({ state, token: "test", repo: await makeRepo(), launchers: { codex: () => ({ file: process.execPath, args: [FAKE] }) } });
    apps.push(app);
    const headers = { host: "127.0.0.1:8790", "x-taskpilot-token": "test" };
    const usage = async () => (await app.inject({ url: "/api/usage", headers })).json();
    expect((await usage())?.agents?.codex).toBeUndefined();
    const session = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers, payload: { agent: "codex" } })).json();
    await vi.waitFor(async () => expect((await usage()).agents.codex).toMatchObject({ planType: "plus", fiveHour: { usedPercentage: 0 }, sevenDay: { usedPercentage: 5 } }));
    await app.inject({ method: "POST", url: `/api/sessions/${session.id}/input`, headers, payload: { text: "hello" } });
    await vi.waitFor(async () => expect((await app.inject({ url: "/api/tasks/DEMO-1/activity", headers })).json().some((i: { kind: string }) => i.kind === "stop")).toBe(true));
  });

  it("keeps the session working when rate limits cannot be read", async () => {
    const { manager, session, waitStop } = await setup({ FAKE_CODEX_NO_RATE_LIMITS: "1" });
    const limits: unknown[] = [];
    manager.on("rateLimits", (_meta, data) => limits.push(data));
    manager.paste(session.id, "hello");
    await waitStop();
    expect(limits).toEqual([]);
  });
});
