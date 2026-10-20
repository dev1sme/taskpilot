import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { get, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

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
