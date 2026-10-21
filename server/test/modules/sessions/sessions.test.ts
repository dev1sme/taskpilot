import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket } from "ws";
import { buildApp } from "../../../src/app.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { type Launcher } from "../../../src/core/claude/launch.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

/** Stands in for claude: prints how it was started, then echoes every input line. */
const fakeClaude: Launcher = (id, { resume }) => ({
  file: "/bin/sh",
  args: ["-c", 'echo "$1 $2"; while read -r line; do echo "got:$line"; done', "sh", resume ? "resumed" : "new", id],
});

let app: FastifyInstance | undefined;
// Copilot sessions install their hooks under COPILOT_HOME: keep that out of the real ~/.copilot.
const realCopilotHome = process.env.COPILOT_HOME;
let copilotHome = "";
beforeAll(async () => {
  copilotHome = await tempDir("taskpilot-copilot-home-");
  process.env.COPILOT_HOME = copilotHome;
});
const managers: SessionManager[] = [];
afterEach(async () => {
  await app?.close();
  for (const m of managers.splice(0)) m.closeAll();
});
afterAll(async () => {
  if (realCopilotHome === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = realCopilotHome;
  await cleanupTempDirs();
});

async function start() {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  app = await buildApp({ token: TOKEN, state, repo: await makeRepo(), launcher: fakeClaude });
  return { app, state };
}

type Frame = { t: "o"; d: string } | { t: "x"; code: number | null };

/** Collects frames from a PTY socket; `until` resolves once the joined output matches. */
function collect(ws: WebSocket) {
  const frames: Frame[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (raw) => {
    frames.push(JSON.parse(String(raw)) as Frame);
    waiters.splice(0).forEach((w) => w());
  });
  const output = () => frames.flatMap((f) => (f.t === "o" ? [f.d] : [])).join("");
  const until = (pred: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; output so far: ${JSON.stringify(output())}`)), 5000);
      const check = () => {
        if (pred()) {
          clearTimeout(timer);
          resolve();
        } else waiters.push(check);
      };
      check();
    });
  return { frames, output, until, exited: () => frames.some((f) => f.t === "x") };
}

async function connect(app: FastifyInstance, id: string) {
  const ws = await app.injectWS(`/api/sessions/${id}/pty`, { headers: ok });
  const c = collect(ws);
  ws.send(JSON.stringify({ t: "r", cols: 80, rows: 24 }));
  return { ws, ...c };
}

describe("sessions", () => {
  it("creates a session, streams output and accepts input", async () => {
    const { app } = await start();
    const created = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok });
    expect(created.statusCode).toBe(200);
    const s = created.json();
    expect(s).toMatchObject({ taskKey: "DEMO-1", title: "Session 1", status: "running" });

    const term = await connect(app, s.id);
    await term.until(() => term.output().includes(`new ${s.id}`));
    term.ws.send(JSON.stringify({ t: "i", d: "hello\r" }));
    await term.until(() => term.output().includes("got:hello"));
    term.ws.close();
  });

  it("replays scrollback to a client that attaches later", async () => {
    const { app } = await start();
    const s = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    const first = await connect(app, s.id);
    first.ws.send(JSON.stringify({ t: "i", d: "one\r" }));
    await first.until(() => first.output().includes("got:one"));
    first.ws.close();

    const second = await connect(app, s.id);
    await second.until(() => second.output().includes("got:one"));
    second.ws.close();
  });

  it("stops, resumes with the same id, and forgets", async () => {
    const { app, state } = await start();
    const s = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    const term = await connect(app, s.id);
    await term.until(() => term.output().includes("new"));

    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${s.id}`, headers: ok })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/api/sessions/${s.id}/stop`, headers: ok });
    await term.until(term.exited);

    const listed = (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    expect(listed).toMatchObject([{ id: s.id, status: "exited" }]);

    const resumed = await app.inject({ method: "POST", url: `/api/sessions/${s.id}/resume`, headers: ok });
    expect(resumed.json()).toMatchObject({ id: s.id, status: "running" });
    await term.until(() => term.output().includes(`resumed ${s.id}`));
    expect((await app.inject({ method: "POST", url: `/api/sessions/${s.id}/resume`, headers: ok })).statusCode).toBe(409);

    await app.inject({ method: "POST", url: `/api/sessions/${s.id}/stop`, headers: ok });
    await term.until(() => term.frames.filter((f) => f.t === "x").length === 2);
    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${s.id}`, headers: ok })).statusCode).toBe(200);
    expect((await state.load()).sessions).toEqual([]);
    term.ws.close();
  });

  it("numbers sessions per task and persists them", async () => {
    const { app, state } = await start();
    await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok });
    const second = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    expect(second.title).toBe("Session 2");
    expect((await state.load()).sessions.map((s) => s.title)).toEqual(["Session 1", "Session 2"]);
  });

  it("rejects unknown tasks and bad ids", async () => {
    const { app } = await start();
    expect((await app.inject({ method: "POST", url: "/api/tasks/NOPE-1/sessions", headers: ok })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/sessions/xyz/stop", headers: ok })).statusCode).toBe(400);
  });

  it("closes the socket for an unknown session", async () => {
    const { app } = await start();
    // injectWS never emits "close" for a server-initiated close, so use a real socket here.
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/00000000-0000-4000-8000-000000000000/pty`, {
      headers: { "x-taskpilot-token": TOKEN },
    });
    const code = await new Promise<number>((resolve) => ws.on("close", resolve));
    expect(code).toBe(4404);
  });

  it("lets a session cookie through to the PTY socket", async () => {
    const { app } = await start();
    const login = await app.inject({ method: "POST", url: "/api/login", headers: { host: ok.host }, payload: { token: TOKEN } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    // Unknown session: 4404 means the upgrade got past the login check.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/00000000-0000-4000-8000-000000000000/pty`, { headers: { cookie } });
    const code = await new Promise<number>((resolve) => ws.on("close", resolve));
    expect(code).toBe(4404);
  });

  it("refuses cross-site WebSocket origins even with a token", async () => {
    const { app } = await start();
    const res = await app.inject({
      url: "/api/repo",
      headers: { ...ok, origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("repo sessions", () => {
  it("runs Claude in the repo without a task", async () => {
    const { app } = await start();
    const created = await app.inject({ method: "POST", url: "/api/repo/sessions", headers: ok });
    expect(created.statusCode).toBe(200);
    const s = created.json();
    expect(s).toMatchObject({ taskKey: "@repo", title: "Session 1", status: "running" });

    const term = await connect(app, s.id);
    await term.until(() => term.output().includes(`new ${s.id}`));
    await app.inject({ method: "POST", url: `/api/sessions/${s.id}/stop`, headers: ok });
    await term.until(term.exited);
    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${s.id}`, headers: ok })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/repo/sessions", headers: ok })).json()).toEqual([]);
    term.ws.close();
  });

  it("keeps repo and task sessions apart", async () => {
    const { app } = await start();
    const repoSession = (await app.inject({ method: "POST", url: "/api/repo/sessions", headers: ok })).json();
    const taskSession = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    expect(taskSession.title).toBe("Session 1");

    const repoList = (await app.inject({ url: "/api/repo/sessions", headers: ok })).json();
    expect(repoList.map((s: { id: string }) => s.id)).toEqual([repoSession.id]);
    const taskList = (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    expect(taskList.map((s: { id: string }) => s.id)).toEqual([taskSession.id]);

    const tasks = (await app.inject({ url: "/api/tasks", headers: ok })).json();
    const running = Object.fromEntries(tasks.map((t: { key: string; sessionsRunning: number }) => [t.key, t.sessionsRunning]));
    expect(running).toEqual({ "DEMO-1": 1, "DEMO-2": 0 });
    // The reserved key is not a task key, so task routes cannot reach repo sessions.
    expect((await app.inject({ url: "/api/tasks/@repo/sessions", headers: ok })).statusCode).toBe(400);
  });

  it("goes through the login and Host checks", async () => {
    const { app } = await start();
    expect((await app.inject({ method: "POST", url: "/api/repo/sessions", headers: { host: ok.host } })).statusCode).toBe(401);
    const evil = await app.inject({ method: "POST", url: "/api/repo/sessions", headers: { ...ok, host: "evil.example" } });
    expect(evil.statusCode).toBe(403);
  });

  it("needs a repo", async () => {
    const state = new StateStore(await tempDir("taskpilot-state-"));
    app = await buildApp({ token: TOKEN, state, launcher: fakeClaude });
    expect((await app.inject({ url: "/api/repo/sessions", headers: ok })).statusCode).toBe(409);
  });
});

/**
 * Stands in for copilot: shows the trust prompt until a line arrives, then the input box footer
 * (its ready marker). Every prompt line then fires hooks the way copilot 1.0.100 does: SessionStart
 * only now, no tool_use_id, PermissionRequest in camelCase and also for tools it allows on its own.
 * The prompt "ask" waits for one more line (the user's answer) before the tool runs.
 */
const COPILOT_SCRIPT = `
post() { curl -sS -m 5 -o /dev/null -X POST -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" \\
  -H "content-type: application/json" --data-binary "$2" "$TASKPILOT_HOOK_URL/$1"; }
echo "Confirm folder trust"
read -r answer
printf '\\033[2m/ commands\\033[0m · ? help\\n'
while IFS= read -r line; do
  cmd="npm test"; [ "$line" = ask ] && cmd="npm run build"
  post UserPromptSubmit '{"session_id":"'"$1"'","prompt":"x"}'
  post SessionStart '{"session_id":"'"$1"'","source":"new"}'
  post PreToolUse '{"session_id":"'"$1"'","tool_name":"Bash","tool_input":{"command":"'"$cmd"'"}}'
  post PermissionRequest '{"hookName":"permissionRequest","sessionId":"'"$1"'","toolName":"bash","toolInput":{"command":"'"$cmd"'"}}'
  if [ "$line" = ask ]; then read -r answer; fi
  post PostToolUse '{"session_id":"'"$1"'","tool_name":"Bash","tool_input":{"command":"'"$cmd"'","description":"Run it"},"tool_result":{"result_type":"success"}}'
  post Stop '{"session_id":"'"$1"'","transcript_path":"/nonexistent/events.jsonl","stop_reason":"end_turn"}'
done`;
const fakeCopilot: Launcher = (id) => ({ file: "/bin/sh", args: ["-c", COPILOT_SCRIPT, "sh", id] });

/**
 * Stands in for a copilot whose hooks never run (TPL-017): the prompt "work" ends a turn in
 * events.jsonl, "tool" is followed by a tool call that is still running.
 */
const HOOKLESS_SCRIPT = `
echo ready
dir="$COPILOT_HOME/session-state/$1"; mkdir -p "$dir"; : > "$dir/events.jsonl"
line() { printf '{"type":"%s","timestamp":"%s"}\\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" >> "$dir/events.jsonl"; }
while IFS= read -r l; do
  line user.message; line assistant.turn_start; line assistant.turn_end
  # A bracketed paste arrives with its escape sequences around the text.
  case "$l" in *tool*) line assistant.turn_start; line tool.execution_start;; esac
done`;
const hooklessCopilot: Launcher = (id) => ({ file: "/bin/sh", args: ["-c", HOOKLESS_SCRIPT, "sh", id] });

describe("launcher env", () => {
  it("reaches the child on top of the inherited environment, and not Claude's", async () => {
    const state = new StateStore(await tempDir("taskpilot-state-"));
    const printEnv = (env?: Record<string, string>): Launcher => (id) => ({
      file: "/bin/sh",
      args: ["-c", 'echo "env:[$TP_LAUNCH_VAR]"; cat', "sh", id],
      ...(env ? { env } : {}),
    });
    app = await buildApp({ token: TOKEN, state, repo: await makeRepo(), launcher: printEnv(), launchers: { copilot: printEnv({ TP_LAUNCH_VAR: "yes" }) } });
    const open = async (agent: string) => {
      const s = (await app!.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok, payload: { agent } })).json();
      return connect(app!, s.id);
    };
    const copilot = await open("copilot");
    await copilot.until(() => copilot.output().includes("env:[yes]"));
    const claude = await open("claude");
    await claude.until(() => claude.output().includes("env:[]"));
    copilot.ws.close();
    claude.ws.close();
  });
});

describe("copilot sessions", () => {
  async function startCopilot() {
    const state = new StateStore(await tempDir("taskpilot-state-"));
    const repo = await makeRepo();
    app = await buildApp({ token: TOKEN, state, repo, launcher: fakeClaude, launchers: { copilot: fakeCopilot }, copilotQuota: async () => ({ ok: true, snapshots: { premium_interactions: { remainingPercentage: 75 } } }) });
    await app.listen({ host: "127.0.0.1", port: 0 });
    return { app, repo };
  }
  const list = async () => (await app!.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();

  it("writes the user-level hook file, waits for the input box, and maps copilot's hooks", async () => {
    const { app, repo } = await startCopilot();
    const s = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/sessions", headers: ok, payload: { agent: "copilot" } })).json();
    expect(s).toMatchObject({ agent: "copilot", status: "running" });
    const hooks = JSON.parse(await readFile(path.join(copilotHome, "hooks", "taskpilot.json"), "utf8")).hooks;
    expect(Object.keys(hooks)).toContain("Stop");
    await expect(readFile(path.join(repo, ".github", "copilot", "settings.local.json"), "utf8")).rejects.toThrow();

    const term = await connect(app, s.id);
    await term.until(() => term.output().includes("Confirm folder trust"));
    await new Promise((r) => setTimeout(r, 200));
    expect((await list())[0].activity).toBe("starting");

    term.ws.send(JSON.stringify({ t: "i", d: "1\r" }));
    await term.until(() => term.output().includes("? help"));
    for (let i = 0; i < 50 && (await list())[0].activity !== "idle"; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await list())[0].activity).toBe("idle");
    // The footer needs no turn to end: the quota is read as soon as the session is ready.
    let early: { agents?: { copilot?: unknown } } | null = null;
    for (let i = 0; i < 50 && !early?.agents?.copilot; i++) {
      await new Promise((r) => setTimeout(r, 50));
      early = (await app.inject({ url: "/api/usage", headers: ok })).json();
    }
    expect(early?.agents?.copilot).toBeTruthy();

    term.ws.send(JSON.stringify({ t: "i", d: "go\r" }));
    let feed: Array<{ kind: string; status?: string; summary: string }> = [];
    for (let i = 0; i < 100 && !feed.some((f) => f.kind === "stop"); i++) {
      await new Promise((r) => setTimeout(r, 50));
      feed = (await app.inject({ url: "/api/tasks/DEMO-1/activity", headers: ok })).json();
    }
    // The tool ran at once, so its PermissionRequest was not a question to the user.
    expect(feed.map((f) => f.kind)).toEqual(["session", "prompt", "tool", "stop"]);
    expect(feed.find((f) => f.kind === "tool")).toMatchObject({ status: "done", summary: expect.stringContaining("npm test") });
    expect((await list())[0].activity).toBe("idle");
    // The turn's Stop refreshes Copilot's account quota.
    let usage: { agents?: { copilot?: { usedPercentage: number } } } | null = null;
    for (let i = 0; i < 50 && !usage?.agents?.copilot; i++) {
      await new Promise((r) => setTimeout(r, 50));
      usage = (await app.inject({ url: "/api/usage", headers: ok })).json();
    }
    expect(usage?.agents?.copilot).toMatchObject({ usedPercentage: 25, unlimited: false });

    term.ws.send(JSON.stringify({ t: "i", d: "ask\r" }));
    for (let i = 0; i < 100 && (await list())[0].activity !== "permission"; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await list())[0].activity).toBe("permission");
    feed = (await app.inject({ url: "/api/tasks/DEMO-1/activity", headers: ok })).json();
    expect(feed.at(-1)).toMatchObject({ kind: "permission", summary: expect.stringContaining("npm run build") });
    term.ws.send(JSON.stringify({ t: "i", d: "y\r" }));
    for (let i = 0; i < 100 && (await list())[0].activity !== "idle"; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await list())[0].activity).toBe("idle");
    term.ws.close();
   }, 15_000);

  describe("when no hook arrives", () => {
    async function hookless() {
      const state = new StateStore(await tempDir("taskpilot-state-"));
      const repo = await makeRepo();
      const manager = new SessionManager(state, { launchers: { copilot: hooklessCopilot }, transcriptPollMs: 30, transcriptIdleMs: 250 });
      managers.push(manager);
      const stops: Array<Record<string, unknown>> = [];
      manager.on("hook", (_meta, event, payload) => event === "Stop" && stops.push(payload));
      const { id } = await manager.create(repo, "DEMO-1", { agent: "copilot" });
      for (let i = 0; i < 100 && !(await waitReady(id)); i++) await new Promise((r) => setTimeout(r, 30));
      return { manager, stops, id };
    }
    const waitReady = async (id: string) => (await readFile(path.join(copilotHome, "session-state", id, "events.jsonl"), "utf8").catch(() => null)) !== null;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it("takes the end of a turn in events.jsonl for the Stop, once the transcript has been quiet for a while", async () => {
      const { manager, stops, id } = await hookless();
      manager.paste(id, "work");
      await sleep(150);
      expect(stops).toHaveLength(0);
      for (let i = 0; i < 100 && stops.length === 0; i++) await sleep(30);
      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({ session_id: id, source: "transcript" });
      await sleep(400);
      expect(stops).toHaveLength(1);
    });

    it("does not call a turn finished while a tool call is still running", async () => {
      const { manager, stops, id } = await hookless();
      manager.paste(id, "tool");
      await sleep(900);
      expect(stops).toHaveLength(0);
    });

    it("stops watching once a real hook has come", async () => {
      const { manager, stops, id } = await hookless();
      manager.paste(id, "work");
      const token = (manager as unknown as { live: Map<string, { hookToken: string }> }).live.get(id)!.hookToken;
      await manager.handleHook(token, "UserPromptSubmit", { session_id: id });
      await sleep(900);
      expect(stops).toHaveLength(0);
    });
  });

  it("rejects an unknown agent", async () => {
    const { app } = await startCopilot();
    const res = await app.inject({ method: "POST", url: "/api/repo/sessions", headers: ok, payload: { agent: "codex" } });
    expect(res.statusCode).toBe(400);
  });

  it("starts Claude when no agent is given", async () => {
    const { app } = await startCopilot();
    const s = (await app.inject({ method: "POST", url: "/api/repo/sessions", headers: ok })).json();
    expect(s.agent).toBe("claude");
  });
});
