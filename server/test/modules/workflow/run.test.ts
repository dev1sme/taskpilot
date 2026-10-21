import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import type { Launcher } from "../../../src/core/claude/launch.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

/**
 * Stands in for claude with hooks: reports SessionStart, then a Stop after every input line.
 * Writes 02-plan.md when the prompt mentions it, like Claude doing the investigate step.
 */
const SCRIPT = `
post() { printf '{"session_id":"%s"}' "$1" | curl -sS -m 5 -o /dev/null -X POST \\
  -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" -H "content-type: application/json" \\
  --data-binary @- "$TASKPILOT_HOOK_URL/$2"; }
post "$1" SessionStart
while IFS= read -r line; do
  case "$line" in *02-plan.md*) echo plan > .claude/tasks/DEMO-1/02-plan.md ;; esac
  post "$1" Stop
done`;
const hookedClaude: Launcher = (id) => ({ file: "/bin/sh", args: ["-c", SCRIPT, "sh", id] });

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

async function start() {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  app = await buildApp({ token: TOKEN, state, repo: await makeRepo(), launcher: hookedClaude });
  // Hooks need a real port to call back to.
  await app.listen({ host: "127.0.0.1", port: 0 });
  return app;
}

async function waitFor<T>(read: () => Promise<T>, pred: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (pred(v)) return v;
    if (Date.now() > end) throw new Error(`timeout; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("workflow run end to end", () => {
  it("starts a session, sends the prompt after SessionStart and stops at the plan gate", async () => {
    const app = await start();
    const started = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok });
    expect(started.statusCode).toBe(200);

    const view = await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json(),
      (v) => v.run?.phase === "gate",
    );
    expect(view.workflow.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "implement"]);
    expect(view.run.message).toContain("02-plan.md");

    const tasks = (await app.inject({ url: "/api/tasks", headers: ok })).json();
    expect(tasks.find((t: { key: string }) => t.key === "DEMO-1")).toMatchObject({
      run: { phase: "gate", stepIndex: 0 },
      waitingPermission: false,
    });
  });

  it("keeps a session that an active run depends on", async () => {
    const app = await start();
    const run = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    await app.inject({ method: "POST", url: `/api/sessions/${run.sessionId}/stop`, headers: ok });
    await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json(),
      (v) => v.run?.phase === "interrupted",
    );
    const del = await app.inject({ method: "DELETE", url: `/api/sessions/${run.sessionId}`, headers: ok });
    expect(del.statusCode).toBe(409);
    await app.inject({ method: "DELETE", url: "/api/tasks/DEMO-1/run", headers: ok });
    const after = await app.inject({ method: "DELETE", url: `/api/sessions/${run.sessionId}`, headers: ok });
    expect(after.statusCode).toBe(200);
  });

  it("restarts a run from the first step in a new session", async () => {
    const app = await start();
    const none = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/restart", headers: ok });
    expect(none.statusCode).toBe(409);

    const first = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json(),
      (v) => v.run?.phase === "gate",
    );
    const restarted = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/restart", headers: ok });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toMatchObject({ stepIndex: 0 });
    expect(restarted.json().sessionId).not.toBe(first.sessionId);
    // The old session is stopped but stays listed.
    const sessions = await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json(),
      (list: { id: string; status: string }[]) => list.find((x) => x.id === first.sessionId)?.status === "exited",
    );
    expect(sessions).toHaveLength(2);
  });

  it("checks the bodies of approve and reply, and answers only a waiting run", async () => {
    const app = await start();
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: ok, payload: payload as object });
    expect((await post("/api/tasks/DEMO-1/run/approve", { note: 5 })).statusCode).toBe(400);
    expect((await post("/api/tasks/DEMO-1/run/reply", {})).statusCode).toBe(400);
    expect((await post("/api/tasks/DEMO-1/run/reply", { text: "Có" })).statusCode).toBe(404);
  });

  it("rejects hook calls without a valid session token", async () => {
    const app = await start();
    const bad = await app.inject({
      method: "POST",
      url: "/hook/Stop",
      headers: { host: ok.host, "x-taskpilot-hook-token": "nope" },
      payload: {},
    });
    expect(bad.statusCode).toBe(403);
    const unknown = await app.inject({ method: "POST", url: "/hook/Nope", headers: { host: ok.host }, payload: {} });
    expect(unknown.statusCode).toBe(404);
  });
});
