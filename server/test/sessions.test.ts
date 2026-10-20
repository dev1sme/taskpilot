import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { buildApp } from "../src/app.js";
import { childEnv, type Launcher } from "../src/core/claude/launch.js";
import { StateStore } from "../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

/** Stands in for claude: prints how it was started, then echoes every input line. */
const fakeClaude: Launcher = (id, { resume }) => ({
  file: "/bin/sh",
  args: ["-c", 'echo "$1 $2"; while read -r line; do echo "got:$line"; done', "sh", resume ? "resumed" : "new", id],
});

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

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

describe("childEnv", () => {
  it("drops CLAUDE* variables so the child writes its transcript", () => {
    const env = childEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", HOME: "/h" });
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h" });
    expect(Object.keys(env).filter((k) => k.startsWith("CLAUDE"))).toEqual([]);
  });
});

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
