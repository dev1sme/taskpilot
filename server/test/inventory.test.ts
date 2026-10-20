import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readInventory } from "../src/repo/inventory.js";
import { cleanupTempDirs, makeRepo } from "./fixtures.js";

afterAll(cleanupTempDirs);

describe("readInventory", () => {
  it("summarizes CLAUDE.md, .mcp.json and .claude/", async () => {
    const repo = await makeRepo();
    const claude = path.join(repo, ".claude");
    await writeFile(path.join(repo, "CLAUDE.md"), "# Repo\n\n## 1. Identity\nx\n\n## Git\ny\n");
    await writeFile(
      path.join(repo, ".mcp.json"),
      JSON.stringify({ mcpServers: { github: { type: "http", url: "https://x" }, pg: { command: "npx" } } }),
    );
    await mkdir(path.join(claude, "agents"), { recursive: true });
    await writeFile(path.join(claude, "agents", "reviewer.md"), "");
    await mkdir(path.join(claude, "commands", "git"), { recursive: true });
    await writeFile(path.join(claude, "commands", "git", "pr.md"), "");
    await writeFile(path.join(claude, "commands", "fix.md"), "");
    await mkdir(path.join(claude, "skills", "deploy"), { recursive: true });
    await writeFile(path.join(claude, "skills", "deploy", "SKILL.md"), "");
    await mkdir(path.join(claude, "skills", "empty"), { recursive: true });
    await writeFile(
      path.join(claude, "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(npm test)", "Read"], deny: ["Bash(rm *)"] },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "a" }, { type: "command", command: "b" }] }] },
      }),
    );

    expect(await readInventory(repo)).toEqual({
      claudeMd: expect.objectContaining({ exists: true, lines: 8, headings: ["Identity", "Git"] }),
      claudeLocalMd: false,
      mcp: { exists: true, servers: [{ name: "github", type: "http" }, { name: "pg", type: "stdio" }] },
      claudeDir: { agents: 1, commands: 2, skills: 1, hooks: 2, allow: 2, deny: 1 },
    });
  });

  it("reports a broken .mcp.json instead of failing", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, ".mcp.json"), "{ nope");
    const inv = await readInventory(repo);
    expect(inv.mcp.exists).toBe(true);
    expect(inv.mcp.error).toMatch(/JSON/);
    expect(inv.claudeMd.exists).toBe(false);
  });
});
