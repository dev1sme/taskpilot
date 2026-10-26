import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager, type HookEvent } from "../../../src/modules/sessions/index.js";
import { codexTuiLauncher, startHookServer, type HookServer } from "../../helpers/codex-tui.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

/**
 * A Codex session is the Codex TUI in a PTY: the real launcher builds its command line (the stand-in gets it
 * instead of `codex`), hooks come back over HTTP like Claude's, and the thread id comes from the first hook.
 * The stand-in is server/test/helpers/fake-codex-tui.mjs.
 */
const managers: SessionManager[] = [];
const hookServers: HookServer[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.closeAll();
  await Promise.all(hookServers.splice(0).map((server) => server.close()));
});
afterAll(cleanupTempDirs);

class Socket extends EventEmitter {
  readyState = 1;
  OPEN = 1;
  frames: Array<{ t: string; d?: string }> = [];
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
  input(text: string) {
    this.emit("message", JSON.stringify({ t: "i", d: text }));
  }
  /** The terminal's first message; output flows once the client has sized it. */
  resize() {
    this.emit("message", JSON.stringify({ t: "r", cols: 100, rows: 30 }));
  }
}

interface Seen {
  event: HookEvent;
  payload: Record<string, unknown>;
}

async function setup(env: Record<string, string> = {}) {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-sessions-"));
  const log = path.join(state.dir, "codex.jsonl");
  const hooks = await startHookServer();
  hookServers.push(hooks);
  const manager = new SessionManager(state, { launchers: { codex: codexTuiLauncher({ FAKE_CODEX_LOG: log, ...env }) }, hookUrl: hooks.url });
  hooks.attach(manager);
  managers.push(manager);
  const seen: Seen[] = [];
  manager.on("hook", (_meta, event, payload) => seen.push({ event, payload }));
  const records = async (): Promise<Array<{ method: string; params: { threadId: string; model?: string; args: string[]; input: Array<{ text: string }> } }>> =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const events = (name: HookEvent) => seen.filter((s) => s.event === name);
  const activity = async (id: string) => (await manager.get(id)).activity;
  const terminal = async (id: string) => {
    const socket = new Socket();
    await manager.attach(id, socket as unknown as WebSocket);
    socket.resize();
    return socket;
  };
  return { repo, state, manager, hooks, seen, events, records, activity, terminal };
}

describe("Codex session in a PTY", () => {
  it("opens the TUI, becomes ready at the input box and keeps the user's settings out of the command line", async () => {
    const { manager, repo, records } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    const ready = await manager.waitForReady(created.id);
    expect(ready).toMatchObject({ agent: "codex", status: "running", activity: "idle" });
    const [start] = await records();
    expect(start.method).toBe("thread/start");
    // No model, sandbox or approval flag without a permission mode or model: the user's Codex config decides.
    expect(start.params.model).toBeUndefined();
    expect(start.params.args).toContain("--no-daemon");
    expect(start.params.args).not.toContain("-s");
    expect(start.params.args).not.toContain("-m");
    // Hooks per run, no file of the user touched.
    expect(start.params.args.filter((a) => a.startsWith("hooks."))).toHaveLength(7);
    expect(ready.nativeId).toBeUndefined();
  });

  it("passes the permission mode and model to the TUI", async () => {
    const { manager, repo, records } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex", permissionMode: "acceptEdits", model: "gpt-6.1-sol" });
    await manager.waitForReady(created.id);
    const { args, model } = (await records())[0].params;
    expect(model).toBe("gpt-6.1-sol");
    expect(args).toEqual(expect.arrayContaining(["-s", "workspace-write", "-a", "on-request"]));
  });

  it("types a multi-line prompt as one paste, follows the hooks and takes the thread id from the first one", async () => {
    const { manager, repo, records, seen, events, activity } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    const prompt = "PELICAN-42\nSecond line";
    manager.paste(created.id, prompt);
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(1));
    // The newline did not submit the first line alone: one turn with the whole text.
    expect((await records()).filter((r) => r.method === "turn/start").map((r) => r.params.input[0].text)).toEqual([prompt]);
    expect(await activity(created.id)).toBe("idle");
    // Only the one the manager made at the input box: Codex's own SessionStart comes with the first prompt and is dropped.
    expect(events("SessionStart")).toHaveLength(1);
    expect(seen.findIndex((s) => s.event === "SessionStart")).toBeLessThan(seen.findIndex((s) => s.event === "UserPromptSubmit"));
    expect(events("UserPromptSubmit")).toHaveLength(1);
    expect(events("PostToolUse")).toHaveLength(1);
    const view = await manager.get(created.id);
    const threadId = (await records())[0].params.threadId;
    expect(view.nativeId).toBe(threadId);
    expect(view.model).toBe("gpt-6.1-sol");
    // Listeners see TaskPilot's id, never the thread's.
    for (const { payload } of events("Stop")) expect(payload).toMatchObject({ session_id: created.id, last_assistant_message: "DONE" });
    expect(events("Stop")[0].payload.interrupted).toBeUndefined();
  });

  it("stops the TUI and keeps the session resumable", async () => {
    const { manager, repo, state } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    manager.paste(created.id, "hello");
    await vi.waitFor(async () => expect((await manager.get(created.id)).nativeId).toBeTruthy());
    await manager.stopAndWait(created.id);
    const stopped = await manager.get(created.id);
    expect(stopped.status).toBe("exited");
    expect(stopped.processOwner).toBeUndefined();
    expect((await new StateStore(state.dir).load()).sessions[0].nativeId).toBe(stopped.nativeId);
  });

  it("resumes the same thread with `codex resume <thread id>` and the same settings", async () => {
    const { manager, repo, records, events } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex", permissionMode: "acceptEdits", model: "gpt-6.1-sol" });
    await manager.waitForReady(created.id);
    manager.paste(created.id, "REMEMBER-ME\nsecond line");
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(1));
    const nativeId = (await manager.get(created.id)).nativeId!;
    await manager.stopAndWait(created.id);

    const resumed = await manager.resume(created.id);
    expect(resumed.generation).toBe(2);
    await manager.waitForReady(created.id);
    const resume = (await records()).find((r) => r.method === "thread/resume")!;
    expect(resume.params.threadId).toBe(nativeId);
    expect(resume.params.args.slice(0, 2)).toEqual(["resume", nativeId]);
    expect(resume.params.args).toEqual(expect.arrayContaining(["-s", "workspace-write", "-a", "on-request", "-m", "gpt-6.1-sol"]));

    manager.paste(created.id, "RECALL");
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(2));
    // The resumed thread remembers the first prompt, and TaskPilot kept the id of the thread.
    expect(events("Stop")[1].payload.last_assistant_message).toBe("REMEMBER-ME\nsecond line");
    expect((await manager.get(created.id)).nativeId).toBe(nativeId);
  });

  it("refuses to resume a session that never got a thread id", async () => {
    const { manager, repo } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    await manager.stopAndWait(created.id);
    await expect(manager.resume(created.id)).rejects.toThrow(/thread id/);
    expect((await manager.get(created.id)).status).toBe("exited");
  });

  it("shows an approval in the terminal as permission activity and continues after the answer typed there", async () => {
    const { manager, repo, events, activity, terminal } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    const socket = await terminal(created.id);
    manager.paste(created.id, "APPROVAL");
    await vi.waitFor(async () => expect(await activity(created.id)).toBe("permission"));
    await vi.waitFor(() => expect(socket.output).toContain("Would you like to run the following command?"));
    socket.input("y");
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(1));
    expect(events("Stop")[0].payload.last_assistant_message).toBe("APPROVED");
    expect(await activity(created.id)).toBe("idle");

    manager.paste(created.id, "APPROVAL");
    await vi.waitFor(async () => expect(await activity(created.id)).toBe("permission"));
    socket.input("\x1b");
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(2));
    expect(events("Stop")[1].payload.last_assistant_message).toBe("DECLINED");
  });

  it("reports Esc during a running tool as an interrupted Stop and accepts the next prompt", async () => {
    const { manager, repo, events, activity, terminal } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    const socket = await terminal(created.id);
    manager.paste(created.id, "SLOW");
    await vi.waitFor(async () => expect(await activity(created.id)).toBe("busy"));
    socket.input("\x1b");
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(1));
    // Codex fires Interrupt, not Stop, and no answer comes with it.
    expect(events("Stop")[0].payload).toMatchObject({ interrupted: true, session_id: created.id });
    expect(events("Stop")[0].payload.last_assistant_message).toBeUndefined();
    expect(await activity(created.id)).toBe("idle");
    manager.paste(created.id, "after the interrupt");
    await vi.waitFor(async () => expect(events("Stop")).toHaveLength(2));
    expect(events("Stop")[1].payload.last_assistant_message).toBe("DONE");
  });

  it("runs hooks only for a Codex that TaskPilot started", async () => {
    // A Codex the user opens by hand has no TASKPILOT_HOOK_AGENT; their hooks file would run the same command.
    const { manager, repo, records, seen, activity } = await setup({ TASKPILOT_HOOK_AGENT: "" });
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    manager.paste(created.id, "hello");
    await vi.waitFor(async () => expect((await records()).some((r) => r.method === "turn/start")).toBe(true));
    await new Promise((done) => setTimeout(done, 500));
    // Nothing but the ready marker's SessionStart, which the manager makes itself.
    expect(seen.map((s) => s.event)).toEqual(["SessionStart"]);
    expect((await manager.get(created.id)).nativeId).toBeUndefined();
    expect(await activity(created.id)).toBe("idle");
  });

  it("ignores a hook with an unknown token, and a hook after the session stopped", async () => {
    const { manager, repo } = await setup();
    const created = await manager.create(repo, "DEMO-1", { agent: "codex" });
    await manager.waitForReady(created.id);
    const token = (manager as unknown as { live: Map<string, { hookToken: string }> }).live.get(created.id)!.hookToken;
    expect(await manager.handleHook("not-a-token", "UserPromptSubmit", { session_id: "thread-x" })).toBe(false);
    expect((await manager.get(created.id)).nativeId).toBeUndefined();
    await manager.stopAndWait(created.id);
    expect(await manager.handleHook(token, "UserPromptSubmit", { session_id: "thread-x" })).toBe(false);
    expect((await manager.get(created.id)).nativeId).toBeUndefined();
  });
});
