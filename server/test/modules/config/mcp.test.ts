import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EnvStore } from "../../../src/modules/env/store.js";
import { get, home, repo, send, state, useConfigApp } from "../../helpers/configApp.js";

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
