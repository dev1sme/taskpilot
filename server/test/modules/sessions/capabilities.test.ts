import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager, SessionPreflightError, requirePreflight, registerSessionsRoutes, type AgentCapability, type PreflightRequest } from "../../../src/modules/sessions/index.js";
import { probeError } from "../../../src/modules/sessions/backends/probe.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const FAKE = path.resolve(import.meta.dirname, "../../core/codex/fake-app-server.mjs");
const managers: SessionManager[] = [];
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.closeAll());
  vi.unstubAllEnvs();
});
afterAll(cleanupTempDirs);

async function setup(env: Record<string, string> = {}, timeoutMs = 2000) {
  const repo = await makeRepo();
  const dir = await tempDir("capability-state-");
  const log = path.join(dir, "probe.jsonl");
  const state = new StateStore(dir);
  const launch = vi.fn((_id: string, _opts: unknown) => ({ file: process.execPath, args: [FAKE], env }));
  const manager = new SessionManager(state, {
    launchers: { codex: launch },
    extraEnv: async (cwd) => ({ FAKE_CODEX_PROBE_LOG: log, PROBE_MARKER: cwd, CODEX_HOME: path.join(cwd, ".codex-test") }),
    preflightTimeoutMs: timeoutMs,
  });
  managers.push(manager);
  const readLog = async (): Promise<Array<Record<string, unknown>>> =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { repo, manager, state, launch, readLog };
}

async function ptyFixture(script = 'printf "agent-cli 1.2.3\\n"') {
  const file = path.join(await tempDir("capability-cli-"), "agent");
  await writeFile(file, `#!/bin/sh\n${script}\n`);
  await chmod(file, 0o755);
  return file;
}

describe("session capabilities and preflight", () => {
  it("reads every Codex inventory page without a session, thread, turn or state write", async () => {
    const { repo, manager, state, readLog } = await setup({ FAKE_CODEX_PAGES: "1" });
    const result = await manager.preflight(repo, { agent: "codex", model: "gpt-5.6-sol" });
    expect(result.status).toBe("ready");
    expect(result.capability.models.items.length).toBeGreaterThan(2);
    expect(result.capability).toMatchObject({
      cli: { status: "supported", source: "initialize", version: "0.163.0" },
      login: { status: "supported", source: "account/read" },
      quotaDetection: { status: "supported", source: "adapter" },
    });
    expect(result.model).toEqual({ status: "supported", source: "model/list" });
    expect((await readLog()).map((entry) => entry.method)).toEqual(["initialize", "initialized", "account/read", "model/list", "model/list"]);
    expect((await state.load()).sessions).toEqual([]);
  });

  it("blocks logged-out accounts even when model/list returns an offered model", async () => {
    const { repo, manager } = await setup({ FAKE_CODEX_LOGGED_OUT: "1" });
    const result = await manager.preflight(repo, { agent: "codex", model: "gpt-6.1-sol" });
    expect(result.capability.models.status).toBe("supported");
    expect(result.model.status).toBe("supported");
    expect(result.status).toBe("blocked");
    expect(result.errors.map((error) => error.code)).toEqual(["not_logged_in"]);
    expect(() => requirePreflight(result)).toThrow(SessionPreflightError);
    try {
      requirePreflight(result);
    } catch (error) {
      expect(error).toMatchObject({ code: "not_logged_in", status: 503 });
    }
  });

  it("distinguishes an absent model from unreadable inventory, without leaking RPC details", async () => {
    const offered = await setup();
    const unknown = await offered.manager.preflight(offered.repo, { agent: "codex", model: "not-offered" });
    expect(unknown.errors[0].code).toBe("model_unavailable");
    expect(unknown.model.status).toBe("unsupported");
    const failed = await setup({ FAKE_CODEX_INVENTORY_FAIL: "1" });
    const unreadable = await failed.manager.preflight(failed.repo, { agent: "codex", model: "gpt-6.1-sol" });
    expect(unreadable.errors[0].code).toBe("inventory_unavailable");
    expect(unreadable.capability.models).toMatchObject({ status: "unknown", items: [], error: { code: "probe_failed" } });
    expect(JSON.stringify(unreadable)).not.toContain("secret-must-not-leak");
    // A default model needs no inventory membership assertion.
    expect((await failed.manager.preflight(failed.repo, { agent: "codex" })).status).toBe("ready");
  });

  it.each([undefined, "default", "inherit", ""])("keeps model %s as agent default, independent of inventory's default", async (model) => {
    const { repo, manager, launch } = await setup();
    const result = await manager.preflight(repo, { agent: "codex", model });
    expect(result.configuration.model).toBeUndefined();
    expect(result.capability.defaultModel).toEqual({ kind: "agent-default" });
    expect(result.capability).not.toHaveProperty("actualModel");
    expect(launch.mock.calls[0][1]).toMatchObject({ model: undefined });
    const session = await manager.create(repo, "DEMO-1", result.configuration);
    expect(session.model).toBe("actual-default-model");
  });

  it.each([
    [{ permissionMode: "plan" }, "unsupported_permission"],
    [{ permissionMode: "bypassPermissions" }, "unsupported_permission"],
    [{ subagent: "reviewer" }, "unsupported_subagent"],
    [{ model: "--other-flag" }, "invalid_model"],
  ] as const)("rejects incompatible options %j before probing", async (options, code) => {
    const { repo, manager, launch } = await setup();
    const request = { agent: "codex", ...options } as PreflightRequest;
    const result = await manager.preflight(repo, request);
    expect(result.status).toBe("blocked");
    expect(result.errors[0].code).toBe(code);
    expect(result.configuration).toEqual(request);
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    [{ FAKE_CODEX_PROTOCOL: "1" }, "cli", "protocol"],
    [{ FAKE_CODEX_ACCOUNT_INVALID: "1" }, "login", "protocol"],
    [{ FAKE_CODEX_FAIL: "1" }, "cli", "probe_failed"],
  ] as const)("reports protocol/startup/account failure %j with typed errors", async (env, field, code) => {
    const { repo, manager } = await setup(env);
    const result = await manager.preflight(repo, { agent: "codex" });
    expect(result.status).toBe("blocked");
    expect(result.errors[0]).toMatchObject({ field, code });
  });

  it.each(["initialize", "account/read", "model/list"])("bounds a hanging %s with a total deadline", async (method) => {
    const { repo, manager } = await setup({ FAKE_CODEX_HANG_METHOD: method }, 150);
    const start = Date.now();
    const result = await manager.preflight(repo, { agent: "codex", model: "gpt-6.1-sol" });
    expect(result.status).toBe("blocked");
    expect(JSON.stringify(result)).toContain('"code":"timeout"');
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("uses the same repo, environment precedence, launcher and permission/model options as launch", async () => {
    vi.stubEnv("TASKPILOT_TOKEN", "private-ui-token");
    vi.stubEnv("CLAUDECODE", "parent-session");
    const { repo, manager, readLog, launch } = await setup({ PROBE_MARKER: "launcher-wins" });
    const configuration = { agent: "codex", permissionMode: "acceptEdits", model: "gpt-6.1-sol" } as const;
    await manager.preflight(repo, configuration);
    const session = await manager.create(repo, "DEMO-1", configuration);
    expect(launch.mock.calls[0][1]).toMatchObject(launch.mock.calls[1][1]);
    const log = await readLog();
    expect(log.every((entry) => entry.cwd === repo && entry.marker === "launcher-wins" && entry.codexHome === path.join(repo, ".codex-test"))).toBe(true);
    expect(log.every((entry) => entry.uiToken === undefined && entry.claudeEntry === undefined)).toBe(true);
    expect(log.find((entry) => entry.method === "thread/start")?.params).toEqual({ cwd: repo, model: "gpt-6.1-sol", sandbox: "workspace-write", approvalPolicy: "on-request" });
    expect(session.nativeId).toBe("fake-preflight-thread");
  });

  it("does not reuse model or login results across repos or environment changes", async () => {
    const { repo, manager } = await setup();
    const otherRepo = await makeRepo();
    expect((await manager.preflight(repo, { agent: "codex", model: "gpt-6.1-sol" })).status).toBe("ready");
    vi.stubEnv("FAKE_CODEX_LOGGED_OUT", "1");
    vi.stubEnv("FAKE_CODEX_MODELS", JSON.stringify([{ id: "other-model", isDefault: true }]));
    const next = await manager.preflight(otherRepo, { agent: "codex", model: "gpt-6.1-sol" });
    expect(next.errors.map((error) => error.code)).toEqual(["not_logged_in", "model_unavailable"]);
    vi.unstubAllEnvs();
    expect((await manager.preflight(repo, { agent: "codex", model: "gpt-6.1-sol" })).status).toBe("ready");
  });

  it.each(["claude", "copilot"] as const)("keeps %s login/models unknown and preserves legacy workflow options", async (agent) => {
    const repo = await makeRepo();
    const file = await ptyFixture();
    const manager = new SessionManager(new StateStore(await tempDir("pty-capability-")), { launchers: { [agent]: () => ({ file, args: [] }) } });
    managers.push(manager);
    const request = { agent, model: agent === "claude" ? "sonnet" : "legacy-model", subagent: "custom-member", permissionMode: "plan" };
    const result = await manager.preflight(repo, request);
    expect(result).toMatchObject({
      status: "unknown",
      configuration: request,
      errors: [],
      model: { status: "unknown" },
      capability: { cli: { status: "supported", version: "1.2.3" }, login: { status: "unknown" }, models: { status: "unknown", items: [] }, defaultModel: { kind: "agent-default" } },
    });
  });

  it("bounds a PTY version probe and classifies missing CLI separately", async () => {
    const repo = await makeRepo();
    const file = await ptyFixture("exec sleep 10");
    const manager = new SessionManager(new StateStore(await tempDir("missing-cli-")), {
      launchers: { claude: () => ({ file: "/no/such/cli", args: [] }), copilot: () => ({ file, args: [] }), codex: () => ({ file: "/no/such/codex", args: [] }) },
      preflightTimeoutMs: 100,
    });
    managers.push(manager);
    const { agents } = await manager.capabilities(repo);
    expect(agents.map((capability) => capability.cli.error?.code)).toEqual(["missing_cli", "timeout", "missing_cli"]);
    expect(agents[0].cli.status).toBe("unsupported");
  });

  it("classifies verified network errno and leaves arbitrary error text unknown", () => {
    expect(probeError("codex", { code: "ECONNRESET" }, "login").code).toBe("network");
    expect(probeError("codex", new Error("network quota exhausted secret"), "login")).toMatchObject({ code: "probe_failed" });
  });

  it("serves authenticated capability API, isolates CLI failures, and never exposes env/account data", async () => {
    const repo = await makeRepo();
    const file = await ptyFixture();
    const app = await buildApp({
      state: new StateStore(await tempDir("capability-api-")),
      token: "test",
      repo,
      launchers: {
        claude: () => ({ file, args: [] }),
        copilot: () => ({ file: "/no/such/copilot", args: [] }),
        codex: () => ({ file: process.execPath, args: [FAKE], env: { FAKE_CODEX_INVENTORY_FAIL: "1" } }),
      },
    });
    try {
      expect((await app.inject({ url: "/api/sessions/capabilities" })).statusCode).toBe(401);
      const response = await app.inject({ url: "/api/sessions/capabilities", headers: { host: "127.0.0.1:8790", "x-taskpilot-token": "test" } });
      expect(response.statusCode).toBe(200);
      const agents: AgentCapability[] = response.json().agents;
      expect(agents.map((capability) => capability.cli.status)).toEqual(["supported", "unsupported", "supported"]);
      expect(agents[2].models.status).toBe("unknown");
      expect(response.body).not.toMatch(/<EMAIL>|<ID>|<CODEX_HOME>|secret-must-not-leak|extraEnv|TASKPILOT_TOKEN/);
    } finally {
      await app.close();
    }
  });

  it("captures current repo per capability request across repo switches", async () => {
    const { manager, repo } = await setup();
    const otherRepo = await makeRepo();
    let current = repo;
    const calls: string[] = [];
    vi.spyOn(manager, "capabilities").mockImplementation(async (cwd) => {
      calls.push(cwd);
      return { agents: [(await manager.preflight(cwd, { agent: "codex" })).capability] };
    });
    const app = Fastify();
    registerSessionsRoutes(app, {
      repo: { current: () => current, require: () => current, set: async (input) => (current = input) },
      sessions: manager,
      runs: { usesSession: async () => false },
    });
    try {
      await app.inject({ url: "/api/sessions/capabilities" });
      current = otherRepo;
      await app.inject({ url: "/api/sessions/capabilities" });
      expect(calls).toEqual([repo, otherRepo]);
    } finally {
      await app.close();
    }
  });
});
