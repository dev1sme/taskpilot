import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { hostnameOf, isLoopbackHost } from "../src/security.js";
import { StateStore } from "../src/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

async function start(repo?: string) {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  app = await buildApp({ token: TOKEN, state, repo });
  return { app, state };
}

describe("security", () => {
  it.each([
    ["127.0.0.1:8790", true],
    ["localhost:5173", true],
    ["LOCALHOST", true],
    ["[::1]:8790", true],
    ["evil.example:8790", false],
    ["127.0.0.1.evil.example", false],
  ])("isLoopbackHost(%j) = %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });

  it("strips ports, keeps IPv6 brackets", () => {
    expect(hostnameOf("[::1]:80")).toBe("[::1]");
    expect(hostnameOf("a:1")).toBe("a");
  });

  it("rejects a rebinding Host even with a valid token", async () => {
    const { app } = await start();
    const res = await app.inject({ url: "/api/repo", headers: { ...ok, host: "evil.example:8790" } });
    expect(res.statusCode).toBe(403);
  });

  it("requires the token on /api", async () => {
    const { app } = await start();
    expect((await app.inject({ url: "/api/repo", headers: { host: ok.host } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/repo", headers: { ...ok, "x-taskpilot-token": "nope" } })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/repo?token=${TOKEN}`, headers: { host: ok.host } })).statusCode).toBe(200);
  });
});

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

  it("rejects a missing repo path", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "PUT", url: "/api/repo", headers: ok, payload: { path: "/no/such/dir" } });
    expect(res.statusCode).toBe(400);
  });

  it("uses the repo passed at startup", async () => {
    const repo = await makeRepo();
    const { app } = await start(repo);
    expect((await app.inject({ url: "/api/tasks", headers: ok })).json()).toHaveLength(2);
  });
});
