import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { EnvStore } from "../src/sessions/envStore.js";
import { StateStore } from "../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };
const saved = { ...process.env };

/**
 * Stands in for `claude mcp add-json|remove|get`, editing the fake ~/.claude.json. Like the real
 * `mcp get`, it prints environment values in clear, which TaskPilot must not pass on.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs");
const file = process.env.TASKPILOT_CLAUDE_JSON;
const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const [, , cmd, sub, ...rest] = process.argv;
if (cmd !== "mcp") process.exit(2);
const d = read();
const scopeIdx = rest.indexOf("--scope");
const scope = scopeIdx >= 0 ? rest[scopeIdx + 1] : "local";
const args = scopeIdx < 0 ? rest : rest.filter((_, i) => i !== scopeIdx && i !== scopeIdx + 1);
const holder = () => {
  if (scope === "user") return (d.mcpServers ??= {});
  d.projects ??= {};
  d.projects[process.cwd()] ??= {};
  return (d.projects[process.cwd()].mcpServers ??= {});
};
if (sub === "add-json") { holder()[args[0]] = JSON.parse(args[1]); fs.writeFileSync(file, JSON.stringify(d)); console.log("Added"); }
else if (sub === "remove") { delete holder()[args[0]]; fs.writeFileSync(file, JSON.stringify(d)); console.log("Removed"); }
else if (sub === "get") {
  const s = (d.mcpServers ?? {})[args[0]] ?? (d.projects?.[process.cwd()]?.mcpServers ?? {})[args[0]];
  console.log(args[0] + ":\\n  Status: " + (process.env.GOOD_TOKEN ? "✔ Connected" : "✘ Failed to connect") + "\\n  Environment:\\n    SECRET=" + JSON.stringify(s?.env ?? {}));
}
`;

let app: FastifyInstance;
let repo: string;
let home: string;
let state: StateStore;

beforeEach(async () => {
  repo = await makeRepo();
  home = await tempDir("taskpilot-home-");
  process.env.TASKPILOT_CLAUDE_HOME = home;
  process.env.TASKPILOT_CLAUDE_JSON = path.join(home, "claude.json");
  const fake = path.join(home, "fake-claude.cjs");
  await writeFile(fake, FAKE_CLAUDE);
  await chmod(fake, 0o755);
  process.env.TASKPILOT_CLAUDE = fake;
  delete process.env.GOOD_TOKEN;
  state = new StateStore(await tempDir("taskpilot-state-"));
  app = await buildApp({ token: TOKEN, state, repo });
});
afterEach(async () => app.close());
afterAll(async () => {
  process.env = saved;
  await cleanupTempDirs();
});

const get = async (url: string) => (await app.inject({ url, headers: ok })).json();
const send = (method: "POST" | "PUT" | "DELETE", url: string, payload?: object) => app.inject({ method, url, headers: ok, payload });

describe("hooks editing", () => {
  const settings = () => path.join(repo, ".claude", "settings.json");

  it("replaces command hooks, keeps other hook types and keys", async () => {
    await writeFile(
      settings(),
      JSON.stringify({
        env: { K: "secret-env" },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "old" }, { type: "prompt", prompt: "keep me" }] }] },
      }),
    );
    const before = await get("/api/config/settings/project/hooks");
    expect(before.hooks).toEqual([{ event: "Stop", matcher: "", command: "old" }]);
    // raw is the "hooks" value as written, prompt hooks included, and nothing else from the file.
    expect(before.raw).toEqual({ Stop: [{ hooks: [{ type: "command", command: "old" }, { type: "prompt", prompt: "keep me" }] }] });

    const body = {
      hooks: [
        { event: "PostToolUse", matcher: "Edit|Write", command: "npx prettier -w", timeout: 30 },
        { event: "Stop", matcher: "", command: "notify-send done" },
      ],
      baseHash: before.hash,
    };
    const preview = (await send("POST", "/api/config/settings/project/hooks/preview", body)).json();
    expect(preview.diff).toContain("npx prettier -w");
    expect(preview.diff).not.toContain("secret-env");

    expect((await send("PUT", "/api/config/settings/project/hooks", body)).statusCode).toBe(200);
    const written = JSON.parse(await readFile(settings(), "utf8"));
    expect(written.env).toEqual({ K: "secret-env" });
    expect(written.hooks).toEqual({
      PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier -w", timeout: 30 }] }],
      Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }, { hooks: [{ type: "prompt", prompt: "keep me" }] }],
    });
  });

  it.each([
    [{ event: "not an event", matcher: "", command: "x" }],
    [{ event: "Stop", matcher: "", command: "a\nb" }],
    [{ event: "Stop", matcher: "", command: "x", timeout: 0 }],
  ])("rejects invalid hook %#", async (hook) => {
    const before = await get("/api/config/settings/project/hooks");
    expect((await send("PUT", "/api/config/settings/project/hooks", { hooks: [hook], baseHash: before.hash })).statusCode).toBe(400);
  });
});

describe("agents, commands and skills", () => {
  it("creates, edits and deletes with backups", async () => {
    const content = "---\nname: reviewer\ndescription: Reviews\n---\nBody\n";
    const created = await send("PUT", "/api/config/library/agents/project", { rel: "reviewer.md", content, baseHash: "absent" });
    expect(created.statusCode).toBe(200);
    const list = await get("/api/config/agents");
    expect(list.map((a: { rel: string }) => a.rel)).toEqual(["reviewer.md"]);

    const raw = await get("/api/config/library/agents/project/raw?rel=reviewer.md");
    const del = await send("DELETE", `/api/config/library/agents/project?rel=reviewer.md&baseHash=${raw.hash}`);
    expect(del.statusCode).toBe(200);
    expect(await get("/api/config/agents")).toEqual([]);
    expect((await get("/api/backups"))[0]).toMatchObject({ existed: true, display: ".claude/agents/reviewer.md" });

    await send("PUT", "/api/config/library/skills/user", { rel: "deploy/SKILL.md", content: "---\nname: deploy\n---\n", baseHash: "absent" });
    expect(await readFile(path.join(home, "skills", "deploy", "SKILL.md"), "utf8")).toContain("deploy");
    await send("PUT", "/api/config/library/commands/project", { rel: "git/pr.md", content: "Open a PR\n", baseHash: "absent" });
    expect((await get("/api/config/commands")).map((c: { name: string }) => c.name)).toEqual(["git:pr"]);
  });

  it.each([
    ["agents", "../evil.md"],
    ["agents", "a/b/c/d.md"],
    ["skills", "deploy/run.sh"],
    ["commands", "a/b/c/d.md"],
  ])("rejects %s path %s", async (kind, rel) => {
    expect((await send("PUT", `/api/config/library/${kind}/project`, { rel, content: "x", baseHash: "absent" })).statusCode).toBe(400);
  });
});

describe("MCP servers, project scope", () => {
  const add = (body: object) => send("PUT", "/api/config/mcp/project", body);

  it("adds a server with a secret kept in the env store and ${VAR} in .mcp.json", async () => {
    const { hash } = await get("/api/config/mcp/project");
    const body = {
      name: "sentry",
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp", "postgresql://app:hunter2@db/x"],
      env: [
        { key: "SENTRY_TOKEN", value: "tok-123", secret: true },
        { key: "ORG", value: "acme" },
      ],
      baseHash: hash,
    };
    const preview = (await send("POST", "/api/config/mcp/project/preview", body)).json();
    expect(preview.secrets).toEqual(["SENTRY_TOKEN"]);
    expect(preview.diff).not.toMatch(/tok-123|hunter2/);

    expect((await add(body)).statusCode).toBe(200);
    const file = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"));
    expect(file.mcpServers.sentry).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp", "postgresql://app:hunter2@db/x"],
      env: { SENTRY_TOKEN: "${SENTRY_TOKEN}", ORG: "acme" },
    });
    expect(await new EnvStore(state.dir).forRepo(repo)).toEqual({ SENTRY_TOKEN: "tok-123" });

    const view = await get("/api/config/mcp");
    expect(view.servers[0]).toMatchObject({ name: "sentry", missingEnv: [], fromTaskPilot: ["SENTRY_TOKEN"] });
    expect(JSON.stringify(await get("/api/env"))).not.toContain("tok-123");

    // Edit form: secrets and URL credentials are masked; sending them back unchanged keeps them.
    const form = await get("/api/config/mcp/project/sentry");
    expect(form.args[2]).toBe("postgresql://••••@db/x");
    const edited = await add({
      name: "sentry",
      originalName: "sentry",
      type: "stdio",
      command: "npx",
      args: form.args,
      env: [
        { key: "SENTRY_TOKEN", value: null },
        { key: "ORG", value: null },
      ],
      baseHash: form.hash,
    });
    expect(edited.statusCode).toBe(200);
    const again = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"));
    expect(again.mcpServers.sentry).toEqual(file.mcpServers.sentry);
  });

  it("refuses duplicates, invalid input and stale edits; deletes with a backup", async () => {
    const { hash } = await get("/api/config/mcp/project");
    const http = { name: "api", type: "http", url: "https://x/mcp", args: [], headers: [], baseHash: hash };
    expect((await add(http)).statusCode).toBe(200);
    const { hash: h2 } = await get("/api/config/mcp/project");
    expect((await add({ ...http, baseHash: h2 })).statusCode).toBe(409);
    expect((await add({ ...http, name: "bad name", baseHash: h2 })).statusCode).toBe(400);
    expect((await add({ ...http, name: "x", url: "ftp://x", baseHash: h2 })).statusCode).toBe(400);
    expect((await add({ ...http, name: "x", baseHash: hash })).statusCode).toBe(409);

    const del = await send("DELETE", `/api/config/mcp/project/api?baseHash=${h2}`);
    expect(del.statusCode).toBe(200);
    expect(JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8")).mcpServers).toEqual({});
  });
});

describe("MCP servers, user scope via claude mcp", () => {
  it("adds, edits keeping values, checks status without leaking, deletes and restores", async () => {
    const body = { name: "gh", type: "http", url: "https://gh/mcp", args: [], headers: [{ key: "Authorization", value: "Bearer s3cret" }], baseHash: "absent" };
    expect((await send("PUT", "/api/config/mcp/user", body)).statusCode).toBe(200);
    const stored = () => readFile(path.join(home, "claude.json"), "utf8").then((t) => JSON.parse(t).mcpServers?.gh);
    expect(await stored()).toEqual({ type: "http", url: "https://gh/mcp", headers: { Authorization: "Bearer s3cret" } });

    const form = await get("/api/config/mcp/user/gh");
    expect(form.headers).toEqual([{ key: "Authorization", value: "••••", reference: false }]);
    await send("PUT", "/api/config/mcp/user", { ...body, originalName: "gh", url: "https://gh/v2", headers: [{ key: "Authorization", value: null }], baseHash: form.hash });
    expect(await stored()).toEqual({ type: "http", url: "https://gh/v2", headers: { Authorization: "Bearer s3cret" } });

    const check = await send("POST", "/api/config/mcp/check/gh");
    expect(check.json()).toEqual({ status: "failed", label: "Failed to connect" });
    expect(check.body).not.toMatch(/SECRET|s3cret/);

    const { hash } = await get("/api/config/mcp/user/gh");
    expect((await send("DELETE", `/api/config/mcp/user/gh?baseHash=${hash}`)).statusCode).toBe(200);
    expect(await stored()).toBeUndefined();

    const [deletedBackup] = await get("/api/backups");
    expect(deletedBackup.mcp).toMatchObject({ scope: "user", name: "gh" });
    expect((await get(`/api/backups/${deletedBackup.id}/diff`)).diff).not.toContain("s3cret");
    expect((await send("POST", `/api/backups/${deletedBackup.id}/restore`)).statusCode).toBe(200);
    expect(await stored()).toEqual({ type: "http", url: "https://gh/v2", headers: { Authorization: "Bearer s3cret" } });
  });

  it("passes the env store to claude for the connection check", async () => {
    await send("PUT", "/api/env/GOOD_TOKEN", { value: "yes" });
    await send("PUT", "/api/config/mcp/local", { name: "x", type: "stdio", command: "x", args: [], env: [], baseHash: "absent" });
    expect((await send("POST", "/api/config/mcp/check/x")).json()).toEqual({ status: "connected", label: "Connected" });
  });
});

describe("fields TaskPilot does not edit", () => {
  it("keeps other hook handler fields and events it does not know yet", async () => {
    const file = path.join(repo, ".claude", "settings.json");
    const handler = { type: "command", command: "lint", if: "Bash(git *)", async: true, statusMessage: "Linting" };
    await writeFile(file, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler] }] } }));
    const before = await get("/api/config/settings/project/hooks");
    expect(before.hooks).toEqual([{ event: "PreToolUse", matcher: "Bash", command: "lint", extra: { if: "Bash(git *)", async: true, statusMessage: "Linting" } }]);

    const hooks = [
      { ...before.hooks[0], timeout: 5 },
      { event: "FutureEvent", matcher: "", command: "echo hi" },
    ];
    expect((await send("PUT", "/api/config/settings/project/hooks", { hooks, baseHash: before.hash })).statusCode).toBe(200);
    expect(JSON.parse(await readFile(file, "utf8")).hooks).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [{ ...handler, timeout: 5 }] }],
      FutureEvent: [{ hooks: [{ type: "command", command: "echo hi" }] }],
    });
  });

  it.each([[{ type: "command" }], [{ command: "x" }], ["text"]])("rejects hook extra %j", async (extra) => {
    const hooks = [{ event: "Stop", matcher: "", command: "x", extra }];
    expect((await send("PUT", "/api/config/settings/project/hooks", { hooks, baseHash: "absent" })).statusCode).toBe(400);
  });

  it("keeps other MCP fields, dropping transport-only ones when the type changes", async () => {
    const mcpFile = path.join(repo, ".mcp.json");
    await writeFile(mcpFile, JSON.stringify({ mcpServers: { s: { type: "stdio", command: "srv", cwd: "/x", timeout: 9000, alwaysLoad: true } } }));
    const form = await get("/api/config/mcp/project/s");
    const stdio = { name: "s", originalName: "s", type: "stdio", command: "srv2", args: [], env: [], baseHash: form.hash };
    expect((await send("PUT", "/api/config/mcp/project", stdio)).statusCode).toBe(200);
    const read = async () => JSON.parse(await readFile(mcpFile, "utf8")).mcpServers.s;
    expect(await read()).toEqual({ type: "stdio", command: "srv2", cwd: "/x", timeout: 9000, alwaysLoad: true });

    const { hash } = await get("/api/config/mcp/project/s");
    const ws = { name: "s", originalName: "s", type: "ws", url: "wss://mcp.example.com/socket", args: [], headers: [], baseHash: hash };
    expect((await send("PUT", "/api/config/mcp/project", ws)).statusCode).toBe(200);
    expect(await read()).toEqual({ type: "ws", url: "wss://mcp.example.com/socket", timeout: 9000, alwaysLoad: true });
  });

  it("validates ws URLs separately from http ones", async () => {
    const base = { name: "w", args: [], headers: [], baseHash: "absent" };
    expect((await send("PUT", "/api/config/mcp/project", { ...base, type: "ws", url: "https://x/mcp" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/mcp/project", { ...base, type: "http", url: "wss://x/mcp" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/mcp/project", { ...base, type: "nope", url: "https://x/mcp" })).statusCode).toBe(400);
  });

  it("flags a url entry without a type, which Claude Code skips", async () => {
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { bare: { url: "https://x/mcp" }, ok: { command: "srv" } } }));
    const { servers } = await get("/api/config/mcp");
    expect(servers.map((s: { name: string; type: string; error?: string }) => [s.name, s.type, Boolean(s.error)])).toEqual([
      ["bare", "?", true],
      ["ok", "stdio", false],
    ]);
  });
});

describe("project memory and linked folders", () => {
  it("uses .claude/CLAUDE.md when it is the only one, warns when both exist", async () => {
    const dotClaude = path.join(repo, ".claude", "CLAUDE.md");
    await writeFile(dotClaude, "# Dot\n");
    expect((await get("/api/config/memory"))[0]).toMatchObject({ exists: true, content: "# Dot\n" });

    await writeFile(path.join(repo, "CLAUDE.md"), "# Root\n");
    const [project] = await get("/api/config/memory");
    expect(project.content).toBe("# Root\n");
    expect(project.checks[0]).toMatchObject({ level: "warn", message: expect.stringContaining(".claude/CLAUDE.md") });
  });

  it("lists nested and symlinked agents and skills, refuses to write through a link", async () => {
    await mkdir(path.join(repo, ".claude", "agents", "team"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "agents", "team", "qa.md"), "---\nname: qa\ndescription: Tests\n---\n");
    expect((await get("/api/config/agents")).map((a: { name: string }) => a.name)).toEqual(["qa"]);

    const shared = await tempDir("taskpilot-shared-");
    await mkdir(path.join(shared, "deploy"));
    await writeFile(path.join(shared, "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship\n---\n");
    await mkdir(path.join(repo, ".claude", "skills"), { recursive: true });
    await symlink(path.join(shared, "deploy"), path.join(repo, ".claude", "skills", "deploy"));
    expect((await get("/api/config/skills")).map((s: { name: string }) => s.name)).toContain("deploy");

    const raw = await get("/api/config/library/skills/project/raw?rel=deploy/SKILL.md");
    const put = await send("PUT", "/api/config/library/skills/project", { rel: "deploy/SKILL.md", content: "x", baseHash: raw.hash });
    expect(put.statusCode).toBe(409);
    expect(await readFile(path.join(shared, "deploy", "SKILL.md"), "utf8")).toContain("Ship");
  });
});
