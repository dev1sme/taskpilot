import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EnvStore } from "../../../src/modules/env/store.js";
import { app, codexHome, copilotHome, get, home, ok, repo, send, state, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

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
    expect(preview.secrets).toEqual(["SENTRY_SENTRY_TOKEN"]);
    expect(preview.diff).not.toMatch(/tok-123|hunter2/);

    expect((await add(body)).statusCode).toBe(200);
    const file = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"));
    expect(file.mcpServers.sentry).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp", "postgresql://app:hunter2@db/x"],
      env: { SENTRY_TOKEN: "${SENTRY_SENTRY_TOKEN}", ORG: "acme" },
    });
    expect(await new EnvStore(state.dir).forRepo(repo)).toEqual({ SENTRY_SENTRY_TOKEN: "tok-123" });

    const view = await get("/api/config/mcp");
    expect(view.servers[0]).toMatchObject({ name: "sentry", missingEnv: [], fromTaskPilot: ["SENTRY_SENTRY_TOKEN"] });
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

  it("prefixes env secret variables with the server name so two servers do not collide", async () => {
    const stdio = (name: string, value: string | null, baseHash: string, extra: object = {}) => ({
      name,
      type: "stdio",
      command: "x",
      args: [],
      env: [{ key: "API_TOKEN", value, secret: true }],
      baseHash,
      ...extra,
    });
    expect((await add(stdio("alpha", "aaa", (await get("/api/config/mcp/project")).hash))).statusCode).toBe(200);
    expect((await add(stdio("beta", "bbb", (await get("/api/config/mcp/project")).hash))).statusCode).toBe(200);
    const file = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"));
    expect(file.mcpServers.alpha.env).toEqual({ API_TOKEN: "${ALPHA_API_TOKEN}" });
    expect(file.mcpServers.beta.env).toEqual({ API_TOKEN: "${BETA_API_TOKEN}" });
    expect(await new EnvStore(state.dir).forRepo(repo)).toEqual({ ALPHA_API_TOKEN: "aaa", BETA_API_TOKEN: "bbb" });
  });

  it("keeps an existing ${VAR} reference when the value is left unchanged", async () => {
    const { hash } = await get("/api/config/mcp/project");
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { old: { type: "stdio", command: "x", env: { API_TOKEN: "${API_TOKEN}" } } } }));
    const form = await get("/api/config/mcp/project/old");
    expect(form.hash).not.toBe(hash);
    const res = await add({
      name: "old",
      originalName: "old",
      type: "stdio",
      command: "x",
      args: [],
      env: [{ key: "API_TOKEN", value: null, secret: true }],
      baseHash: form.hash,
    });
    expect(res.statusCode).toBe(200);
    const file = JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"));
    expect(file.mcpServers.old.env).toEqual({ API_TOKEN: "${API_TOKEN}" });
    expect(await new EnvStore(state.dir).forRepo(repo)).toEqual({});
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

describe("MCP server names that are Object.prototype keys", () => {
  it("rejects __proto__ on GET and DELETE without writing or backing up", async () => {
    const { hash } = await get("/api/config/mcp/project");
    const http = { name: "api", type: "http", url: "https://x/mcp", args: [], headers: [], baseHash: hash };
    expect((await send("PUT", "/api/config/mcp/project", http)).statusCode).toBe(200);
    const file = path.join(repo, ".mcp.json");
    const text = await readFile(file, "utf8");
    const backups = (await get("/api/backups")).length;
    const { hash: h2 } = await get("/api/config/mcp/project");

    for (const scope of ["project", "local", "user"]) {
      expect((await app.inject({ url: `/api/config/mcp/${scope}/__proto__`, headers: ok })).statusCode).toBe(400);
      expect((await send("DELETE", `/api/config/mcp/${scope}/__proto__?baseHash=${h2}`)).statusCode).toBe(400);
    }
    expect(await readFile(file, "utf8")).toBe(text);
    expect((await get("/api/backups")).length).toBe(backups);
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

  it.each(["user", "local"] as const)("keeps the old %s entry when claude rejects the new one", async (scope) => {
    const url = `/api/config/mcp/${scope}`;
    const body = { name: "gh", type: "http", url: "https://gh/mcp", args: [], headers: [], baseHash: "absent" };
    expect((await send("PUT", url, body)).statusCode).toBe(200);
    const before = await get(`${url}/gh`);

    const res = await send("PUT", url, { ...body, originalName: "gh", url: "https://fail.invalid/mcp", baseHash: before.hash });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const after = await get(`${url}/gh`);
    expect(after).toMatchObject({ name: "gh", url: "https://gh/mcp" });
    expect(after.hash).toBe(before.hash);
  });

  it("keeps the current entry when a restore fails", async () => {
    const claudeJson = path.join(home, "claude.json");
    await writeFile(claudeJson, JSON.stringify({ mcpServers: { gh: { type: "http", url: "https://fail.invalid/mcp" } } }));
    const { hash } = await get("/api/config/mcp/user/gh");
    expect((await send("DELETE", `/api/config/mcp/user/gh?baseHash=${hash}`)).statusCode).toBe(200);
    const [deletedBackup] = await get("/api/backups");
    const body = { name: "gh", type: "http", url: "https://gh/mcp", args: [], headers: [], baseHash: "absent" };
    expect((await send("PUT", "/api/config/mcp/user", body)).statusCode).toBe(200);

    const res = await send("POST", `/api/backups/${deletedBackup.id}/restore`);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(await readFile(claudeJson, "utf8")).mcpServers.gh).toEqual({ type: "http", url: "https://gh/mcp" });
  });

  it("passes the env store to claude for the connection check", async () => {
    await send("PUT", "/api/env/GOOD_TOKEN", { value: "yes" });
    await send("PUT", "/api/config/mcp/local", { name: "x", type: "stdio", command: "x", args: [], env: [], baseHash: "absent" });
    expect((await send("POST", "/api/config/mcp/check/x")).json()).toEqual({ status: "connected", label: "Connected" });
  });
});

describe("native MCP adapters", () => {
  it("reads and edits Codex TOML without changing unrelated settings or exposing secrets", async () => {
    const file = path.join(codexHome, "config.toml");
    await writeFile(file, 'approval_policy = "on-request"\n# keep\n[mcp_servers.old]\ncommand = "npx"\nargs = ["--token=hidden"]\n[mcp_servers.old.env]\nTOKEN = "top-secret"\n');
    const list = await get("/api/config/mcp?cli=codex");
    expect(list.servers).toMatchObject([{ name: "old", scope: "user", type: "stdio" }]);
    expect(JSON.stringify(list)).not.toMatch(/top-secret|hidden/);
    const form = await get("/api/config/mcp/user/old?cli=codex");
    expect(form.env[0].value).toBe("••••");
    const body = { name: "old", originalName: "old", type: "stdio", command: "npx", args: form.args, env: [{ key: "TOKEN", value: null }], headers: [], baseHash: form.hash };
    const preview = await send("POST", "/api/config/mcp/user/preview?cli=codex", body);
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toMatch(/top-secret|hidden/);
    expect((await send("PUT", "/api/config/mcp/user?cli=codex", body)).statusCode).toBe(200);
    const parsed = parseToml(await readFile(file, "utf8")) as Record<string, any>;
    expect(parsed.approval_policy).toBe("on-request");
    expect(parsed.mcp_servers.old.env.TOKEN).toBe("top-secret");
    expect((await send("POST", "/api/config/mcp/check/old?cli=codex")).statusCode).toBe(501);
    expect((await send("PUT", "/api/config/mcp/local?cli=codex", body)).statusCode).toBe(400);
  });

  it("removes Codex HTTP headers when the edited list is empty", async () => {
    const file = path.join(codexHome, "config.toml");
    await writeFile(file, '[mcp_servers.api]\nurl = "https://example.test/mcp"\n[mcp_servers.api.http_headers]\nAuthorization = "Bearer old-secret"\n');
    const { hash } = await get("/api/config/mcp/user/api?cli=codex");
    const body = { name: "api", originalName: "api", type: "http", url: "https://example.test/mcp", args: [], headers: [], baseHash: hash };
    expect((await send("PUT", "/api/config/mcp/user?cli=codex", body)).statusCode).toBe(200);
    const data = parseToml(await readFile(file, "utf8")) as { mcp_servers: { api: Record<string, unknown> } };
    expect(data.mcp_servers.api.http_headers).toBeUndefined();
  });

  it("reads Copilot precedence sources and writes only its native target", async () => {
    await mkdir(path.join(repo, ".github"), { recursive: true });
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { shared: { type: "stdio", command: "x" } } }));
    await writeFile(path.join(repo, ".github", "mcp.json"), JSON.stringify({ mcpServers: { project: { type: "http", url: "https://example.test" } } }));
    await writeFile(path.join(copilotHome, "mcp-config.json"), JSON.stringify({ mcpServers: { personal: { type: "local", command: "npx" } } }));
    const list = await get("/api/config/mcp?cli=copilot");
    expect(list.sources.map((s: { path: string }) => s.path)).toEqual([".mcp.json", ".github/mcp.json", path.join(copilotHome, "mcp-config.json")]);
    expect(list.servers.map((s: { name: string }) => s.name)).toEqual(["shared", "project", "personal"]);
    expect(list.servers[0].editable).toBe(false);
    const { hash } = await get("/api/config/mcp/project?cli=copilot");
    const body = { name: "added", type: "http", url: "https://example.test/mcp", args: [], headers: [{ key: "Authorization", value: "Bearer secret" }], baseHash: hash };
    expect((await send("PUT", "/api/config/mcp/project?cli=copilot", body)).statusCode).toBe(200);
    expect(JSON.parse(await readFile(path.join(repo, ".github", "mcp.json"), "utf8")).mcpServers.added.tools).toEqual(["*"]);
    expect(JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8")).mcpServers.added).toBeUndefined();
    expect(
      (await send("POST", "/api/config/mcp/project/preview?cli=copilot", { ...body, originalName: "added", baseHash: (await get("/api/config/mcp/project?cli=copilot")).hash })).body,
    ).not.toContain("Bearer secret");
  });

  it("retains Copilot's bare project format while deleting one server", async () => {
    await mkdir(path.join(repo, ".github"), { recursive: true });
    const file = path.join(repo, ".github", "mcp.json");
    await writeFile(file, JSON.stringify({ one: { type: "local", command: "one" }, two: { type: "http", url: "https://two.test" } }));
    expect((await get("/api/config/mcp?cli=copilot")).servers.map((server: { name: string }) => server.name)).toEqual(["one", "two"]);
    const { hash } = await get("/api/config/mcp/project/one?cli=copilot");
    expect((await send("DELETE", `/api/config/mcp/project/one?cli=copilot&baseHash=${hash}`)).statusCode).toBe(200);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ two: { type: "http", url: "https://two.test" } });
  });
});
