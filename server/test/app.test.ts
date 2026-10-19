import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDotEnv } from "../src/dotenv.js";
import { childEnv } from "../src/sessions/launch.js";
import { hostnameOf, isLoopbackHost, type BasicAuth } from "../src/security.js";
import { StateStore } from "../src/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

async function start(repo?: string, allowedHosts?: string[], auth?: BasicAuth) {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  app = await buildApp({ token: TOKEN, state, repo, allowedHosts, auth });
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

  it("accepts extra allowed hosts and origins, still rejects others", async () => {
    const { app } = await start(undefined, ["172.17.0.1", "TaskPilot.example.dev"]);
    const get = (headers: Record<string, string>) => app.inject({ url: "/api/repo", headers: { ...ok, ...headers } });
    expect((await get({ host: "taskpilot.example.dev" })).statusCode).toBe(200);
    expect((await get({ host: "172.17.0.1:8790" })).statusCode).toBe(200);
    expect((await get({ host: "taskpilot.example.dev", origin: "https://taskpilot.example.dev" })).statusCode).toBe(200);
    expect((await get({ host: "taskpilot.example.dev", origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await get({ host: "evil.example" })).statusCode).toBe(403);
  });

  it("does not pass the UI token or login to sessions", () => {
    const env = childEnv({ TASKPILOT_TOKEN: "t", TASKPILOT_AUTH_USER: "u", TASKPILOT_AUTH_PASSWORD: "p", TASKPILOT_HOME: "/x" });
    expect(env).toMatchObject({ TASKPILOT_HOME: "/x" });
    expect(Object.keys(env).filter((k) => k.startsWith("TASKPILOT_AUTH") || k === "TASKPILOT_TOKEN")).toEqual([]);
  });

  it("requires basic auth when configured, except for hook callbacks", async () => {
    const { app } = await start(undefined, [], { user: "thomson", password: "p:ss wörd" });
    const basic = (cred: string) => `Basic ${Buffer.from(cred).toString("base64")}`;
    const get = (authorization?: string) =>
      app.inject({ url: "/api/repo", headers: { ...ok, ...(authorization ? { authorization } : {}) } });

    const missing = await get();
    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toMatch(/^Basic realm="TaskPilot"/);
    expect((await get(basic("thomson:wrong"))).statusCode).toBe(401);
    expect((await get(basic("other:p:ss wörd"))).statusCode).toBe(401);
    expect((await get("Bearer x")).statusCode).toBe(401);
    expect((await get(basic("thomson:p:ss wörd"))).statusCode).toBe(200);
    // Basic auth does not replace the UI token.
    const noToken = await app.inject({ url: "/api/repo", headers: { host: ok.host, authorization: basic("thomson:p:ss wörd") } });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.headers["www-authenticate"]).toBeUndefined();

    const hook = await app.inject({ method: "POST", url: "/hook/Stop", headers: { host: ok.host }, payload: {} });
    expect(hook.statusCode).toBe(403);
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

describe("dotenv", () => {
  it("fills unset variables only, skips empty values, ignores a missing file", async () => {
    const file = path.join(await tempDir("taskpilot-env-"), ".env");
    await writeFile(file, "A=from-file\nB=from-file\nC=\n# comment\nD=\"quoted value\"\n");
    const env: NodeJS.ProcessEnv = { B: "from-env" };
    loadDotEnv(file, env);
    expect(env).toEqual({ A: "from-file", B: "from-env", D: "quoted value" });
    expect(() => loadDotEnv(path.join(path.dirname(file), "missing.env"), env)).not.toThrow();
  });
});
