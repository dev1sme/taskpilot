import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/app.js";
import { childEnv } from "../../../src/core/launch.js";
import type { Credentials } from "../../../src/modules/auth/sessions.js";
import { hostnameOf, isLoopbackHost } from "../../../src/modules/auth/security.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

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

/** The session cookie from a login response, as a Cookie header value. */
function cookieOf(res: { headers: Record<string, unknown> }): string {
  return String(res.headers["set-cookie"]).split(";")[0];
}

/** Set-Cookie attributes by lowercase name ("" for flags); the order is up to the cookie library. */
function cookieAttrs(res: { headers: Record<string, unknown> }): Record<string, string> {
  const [, ...attrs] = String(res.headers["set-cookie"])
    .split(";")
    .map((a) => a.trim());
  return Object.fromEntries(attrs.map((a) => [a.split("=")[0].toLowerCase(), a.split("=")[1] ?? ""]));
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

  it("password mode: logs in with user and password, then uses the session cookie", async () => {
    const login = { user: "thomson", password: "p:ss wörd" };
    const { state } = await start(undefined, [], login);
    // `app` is the module-level one here: the test rebuilds it to simulate restarts.
    const host = { host: ok.host };
    const post = (payload: object) => app!.inject({ method: "POST", url: "/api/login", headers: host, payload });

    expect((await app!.inject({ url: "/api/auth", headers: host })).json()).toEqual({ mode: "password", authenticated: false });
    expect((await app!.inject({ url: "/api/repo", headers: host })).statusCode).toBe(401);
    // No token configured in password mode: the header is not a way in.
    expect((await app!.inject({ url: "/api/repo", headers: ok })).statusCode).toBe(401);
    expect((await post({ user: "thomson", password: "wrong" })).statusCode).toBe(401);
    expect((await post({ token: TOKEN })).statusCode).toBe(401);

    const res = await post(login);
    expect(res.statusCode).toBe(200);
    expect(cookieOf(res)).toMatch(/^taskpilot_session=[\w-]{40,}$/);
    expect(cookieAttrs(res)).toEqual({ path: "/", httponly: "", samesite: "Strict", "max-age": "604800" });
    const cookie = cookieOf(res);
    expect((await app!.inject({ url: "/api/repo", headers: { ...host, cookie } })).statusCode).toBe(200);
    expect((await app!.inject({ url: "/api/auth", headers: { ...host, cookie } })).json()).toMatchObject({ authenticated: true });
    expect((await app!.inject({ url: "/api/repo", headers: { ...host, cookie: `a=1; ${cookie}; b=2` } })).statusCode).toBe(200);

    // Survives a restart with the same password, not with a changed one.
    await app!.close();
    app = await buildApp({ state, login });
    expect((await app!.inject({ url: "/api/repo", headers: { ...host, cookie } })).statusCode).toBe(200);
    await app!.close();
    app = await buildApp({ state, login: { ...login, password: "changed" } });
    expect((await app!.inject({ url: "/api/repo", headers: { ...host, cookie } })).statusCode).toBe(401);
  });

  it("marks the cookie Secure behind an https proxy, and logout ends the session", async () => {
    const { app } = await start(undefined, [], { user: "u", password: "p" });
    const headers = { host: ok.host, "x-forwarded-proto": "https" };
    const res = await app.inject({ method: "POST", url: "/api/login", headers, payload: { user: "u", password: "p" } });
    expect(cookieAttrs(res)).toMatchObject({ secure: "", httponly: "", samesite: "Strict" });
    const cookie = cookieOf(res);
    const out = await app.inject({ method: "POST", url: "/api/logout", headers: { ...headers, cookie } });
    expect(cookieOf(out)).toBe("taskpilot_session=");
    expect(cookieAttrs(out)).toMatchObject({ "max-age": "0", path: "/" });
    expect((await app.inject({ url: "/api/repo", headers: { ...headers, cookie } })).statusCode).toBe(401);
  });

  it("locks login out after repeated failures", async () => {
    const { app } = await start(undefined, [], { user: "u", password: "p" });
    const post = (password: string) => app.inject({ method: "POST", url: "/api/login", headers: { host: ok.host }, payload: { user: "u", password } });
    for (let i = 0; i < 5; i++) expect((await post("wrong")).statusCode).toBe(401);
    const locked = await post("p");
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("token mode: exchanges the token for a session, keeps the header for scripts, ignores ?token=", async () => {
    const { app } = await start();
    const host = { host: ok.host };
    expect((await app.inject({ url: "/api/auth", headers: host })).json()).toEqual({ mode: "token", authenticated: false });
    expect((await app.inject({ url: `/api/repo?token=${TOKEN}`, headers: host })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/login", headers: host, payload: { token: "nope" } })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/api/login", headers: host, payload: { token: TOKEN } });
    expect((await app.inject({ url: "/api/repo", headers: { ...host, cookie: cookieOf(res) } })).statusCode).toBe(200);
  });

  it("keeps hook callbacks and the client outside the login", async () => {
    const { app } = await start(undefined, [], { user: "u", password: "p" });
    const hook = await app.inject({ method: "POST", url: "/hook/Stop", headers: { host: ok.host }, payload: {} });
    expect(hook.statusCode).toBe(403); // rejected by the hook token, not by the login
  });

  it("requires the token on /api", async () => {
    const { app } = await start();
    expect((await app.inject({ url: "/api/repo", headers: { host: ok.host } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/repo", headers: { ...ok, "x-taskpilot-token": "nope" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/repo", headers: ok })).statusCode).toBe(200);
  });
});
