import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Credentials } from "../src/modules/auth/sessions.js";
import { StateStore } from "../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./helpers/fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

async function start(repo?: string, allowedHosts?: string[], login?: Credentials) {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  // Password mode without TASKPILOT_TOKEN, as the CLI does it.
  app = await buildApp({ token: login ? undefined : TOKEN, state, repo, allowedHosts, login });
  return { app, state };
}

describe("api", () => {
  it("returns 409 for tasks before a repo is selected", async () => {
    const { app } = await start();
    expect((await app.inject({ url: "/api/tasks", headers: ok })).statusCode).toBe(409);
  });

  it("selects a repo, remembers it, lists tasks and reads files", async () => {
    const repo = await makeRepo();
    const { app, state } = await start();

    const put = await app.inject({ method: "PUT", url: "/api/repo", headers: ok, payload: { path: repo } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ tasksDirExists: true });
    expect((await state.load()).lastRepo).toBe(put.json().path);

    const tasks = await app.inject({ url: "/api/tasks", headers: ok });
    expect(tasks.json().map((t: { key: string }) => t.key).sort()).toEqual(["DEMO-1", "DEMO-2"]);

    const file = await app.inject({ url: "/api/tasks/DEMO-1/file?path=spec%2Freq.md", headers: ok });
    expect(file.json().content).toContain("Add /health");

    const escape = await app.inject({ url: "/api/tasks/DEMO-1/file?path=..%2F..%2F..%2Fsecret.md", headers: ok });
    expect(escape.statusCode).toBe(400);
  });

  it("reports the version of every agent's command, null when missing", async () => {
    const { app } = await start();
    const info = (await app.inject({ url: "/api/info", headers: ok })).json();
    expect(Object.keys(info.versions).sort()).toEqual(["claude", "copilot"]);
    expect(info.claudeVersion).toBe(info.versions.claude);
    for (const v of Object.values(info.versions)) expect(v === null || /^\d+\.\d+\.\d+/.test(v as string)).toBe(true);
  });

  it("rejects a missing repo path", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "PUT", url: "/api/repo", headers: ok, payload: { path: "/no/such/dir" } });
    expect(res.statusCode).toBe(400);
  });

  it("reports whether each task is done and marks it done or open, not while its run is active", async () => {
    const repo = await makeRepo();
    const { app, state } = await start();
    const current = (await app.inject({ method: "PUT", url: "/api/repo", headers: ok, payload: { path: repo } })).json().path;
    const doneOf = async (key: string) =>
      (await app.inject({ url: "/api/tasks", headers: ok })).json().find((t: { key: string }) => t.key === key).done;

    expect(await doneOf("DEMO-1")).toBeNull();
    // An older run that reached its end counts while the task has no task.yml.
    await state.update((s) => void s.runs.push({ repo: current, taskKey: "DEMO-2", phase: "done" } as never));
    expect(await doneOf("DEMO-2")).toEqual({ at: null });

    const put = await app.inject({ method: "PUT", url: "/api/tasks/DEMO-1/done", headers: ok, payload: { done: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ done: { at: expect.any(Number) } });
    expect(await doneOf("DEMO-1")).toEqual(put.json().done);
    expect((await app.inject({ url: "/api/tasks/DEMO-1", headers: ok })).json().done).toEqual(put.json().done);

    // The file wins over the run.
    await app.inject({ method: "PUT", url: "/api/tasks/DEMO-2/done", headers: ok, payload: { done: false } });
    expect(await doneOf("DEMO-2")).toBeNull();

    expect((await app.inject({ method: "PUT", url: "/api/tasks/DEMO-1/done", headers: ok, payload: { done: "yes" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/tasks/NOPE/done", headers: ok, payload: { done: true } })).statusCode).toBe(404);

    await state.update((s) => void s.runs.push({ repo: current, taskKey: "DEMO-1", phase: "gate", stepIndex: 0 } as never));
    const busy = await app.inject({ method: "PUT", url: "/api/tasks/DEMO-1/done", headers: ok, payload: { done: false } });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toContain("Huỷ quy trình trước");
  });

  it("uses the repo passed at startup", async () => {
    const repo = await makeRepo();
    const { app } = await start(repo);
    expect((await app.inject({ url: "/api/tasks", headers: ok })).json()).toHaveLength(2);
  });
});
