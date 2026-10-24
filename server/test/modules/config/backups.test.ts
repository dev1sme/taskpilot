import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexHome, get, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

describe("backups", () => {
  it("lists, diffs and restores, backing up the current content first", async () => {
    await send("PUT", "/api/config/memory/project", { content: "v1\n", baseHash: "absent" });
    const v1 = await get("/api/config/memory/project/raw");
    await send("PUT", "/api/config/memory/project", { content: "v2\n", baseHash: v1.hash });

    const list = await get("/api/backups");
    expect(list.map((b: { existed: boolean }) => b.existed)).toEqual([true, false]);
    const [ofV1] = list;
    expect((await get(`/api/backups/${ofV1.id}/diff`)).diff).toContain("+v1");

    expect((await send("POST", `/api/backups/${ofV1.id}/restore`, {})).statusCode).toBe(200);
    expect(await readFile(path.join(repo, "CLAUDE.md"), "utf8")).toBe("v1\n");
    expect((await get("/api/backups"))[0].reason).toMatch(/Trước khi khôi phục/);

    // Restoring the "did not exist" backup removes the file (its content was just backed up).
    await send("POST", `/api/backups/${list[1].id}/restore`, {});
    await expect(readFile(path.join(repo, "CLAUDE.md"), "utf8")).rejects.toThrow();
  });

  it("rejects malformed backup ids", async () => {
    expect((await send("POST", "/api/backups/..%2F..%2Fetc/restore", {})).statusCode).toBe(400);
  });
});

describe("native config backups", () => {
  it("masks Codex MCP and unrelated secrets in diff, then restores the original TOML", async () => {
    const file = path.join(codexHome, "config.toml");
    const original =
      'approval_policy = "on-request"\nprivate_key = "untouchable-secret"\n[mcp_servers.api]\nurl = "https://example.test/mcp?token=url-secret"\n[mcp_servers.api.http_headers]\nAuthorization = "Bearer header-secret"\n';
    await writeFile(file, original);
    const form = await get("/api/config/mcp/user/api?cli=codex");
    const body = { name: "api", originalName: "api", type: "http", url: form.url, args: [], headers: [{ key: "Authorization", value: null }], baseHash: form.hash };
    expect((await send("PUT", "/api/config/mcp/user?cli=codex", body)).statusCode).toBe(200);
    const [backup] = await get("/api/backups");
    const diff = await get(`/api/backups/${backup.id}/diff`);
    expect(JSON.stringify(diff)).not.toMatch(/untouchable-secret|header-secret|url-secret/);
    expect((await send("POST", `/api/backups/${backup.id}/restore`, {})).statusCode).toBe(200);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("omits unknown MCP fields and unrelated JSON secrets from backup diff", async () => {
    const file = path.join(repo, ".mcp.json");
    await writeFile(file, JSON.stringify({ privateNote: "outside-secret", mcpServers: { api: { type: "http", url: "https://api.test", oauth: { client_secret: "nested-secret" } } } }));
    const { hash } = await get("/api/config/mcp/project");
    expect((await send("DELETE", `/api/config/mcp/project/api?baseHash=${hash}`)).statusCode).toBe(200);
    const [backup] = await get("/api/backups");
    const diff = await get(`/api/backups/${backup.id}/diff`);
    expect(JSON.stringify(diff)).not.toMatch(/outside-secret|nested-secret/);
  });
});
