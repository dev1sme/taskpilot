import { mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BackupStore } from "../../../src/modules/config/backups/store.js";
import { configCli, markConfigAvailable, requireConfigScope } from "../../../src/modules/config/shared/agent.js";
import { codexHome as configuredCodexHome, copilotHome as configuredCopilotHome } from "../../../src/modules/config/shared/fs.js";
import { hookTarget, isAllowedPath, libraryTarget, mcpTarget, memoryTarget, settingsTarget } from "../../../src/modules/config/shared/targets.js";
import { hashOf, writeWithBackup } from "../../../src/modules/config/shared/writer.js";
import { DEFAULT_WORKFLOW_DIR } from "../../../src/modules/workflow/definition.js";
import { app, codexHome, copilotHome, get, home, ok, repo, useConfigApp } from "../../helpers/configApp.js";
import { tempDir } from "../../helpers/fixtures.js";

useConfigApp();

describe("isAllowedPath", () => {
  it("allows existing Claude config files", () => {
    expect(isAllowedPath(path.join(repo, "CLAUDE.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(repo, ".claude", "agents", "a.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(home, "skills", "x", "run.sh"), repo)).toBe(true);
    expect(isAllowedPath(path.join(repo, ".claude", "agents"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, "src", "index.ts"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "agents", "..", "..", "package.json"), repo)).toBe(false);
    expect(isAllowedPath("/etc/passwd", repo)).toBe(false);
  });

  it("only permits explicit Codex and Copilot files", () => {
    const allowed = [
      memoryTarget(repo, "project", "codex"),
      memoryTarget(repo, "user", "codex"),
      settingsTarget(repo, "project", "codex"),
      settingsTarget(repo, "user", "codex"),
      libraryTarget(repo, "agents", "project", "reviewer.toml", "codex"),
      libraryTarget(repo, "skills", "user", "audit/SKILL.md", "codex"),
      memoryTarget(repo, "project", "copilot"),
      memoryTarget(repo, "user", "copilot"),
      settingsTarget(repo, "project", "copilot"),
      settingsTarget(repo, "local", "copilot"),
      settingsTarget(repo, "user", "copilot"),
      libraryTarget(repo, "agents", "project", "reviewer.md", "copilot"),
      libraryTarget(repo, "agents", "user", "reviewer.agent.md", "copilot"),
      libraryTarget(repo, "skills", "project", "audit/SKILL.md", "copilot"),
      hookTarget(repo, "project", "pre-commit.json", "copilot"),
      hookTarget(repo, "user", "pre-commit.json", "copilot"),
      mcpTarget(repo, "project", "copilot"),
      mcpTarget(repo, "user", "copilot"),
    ];
    for (const target of allowed) expect(isAllowedPath(target.abs, repo), target.abs).toBe(true);
    for (const file of [
      path.join(copilotHome, "config.json"),
      path.join(copilotHome, "permissions-config.json"),
      path.join(copilotHome, "mcp-secrets", "token"),
      path.join(codexHome, "auth.json"),
      path.join(repo, ".codex", "other.toml"),
      path.join(repo, ".github", "hooks", "nested", "bad.json"),
      path.join(repo, ".github", "agents", "bad.toml"),
      path.join(repo, ".agents", "skills", "audit", "run.sh"),
    ])
      expect(isAllowedPath(file, repo), file).toBe(false);
    expect(() => memoryTarget(repo, "local", "codex")).toThrow();
    expect(() => mcpTarget(repo, "local", "copilot")).toThrow();
    expect(() => mcpTarget(repo, "user", "claude")).toThrow();
  });

  it("allows the workflow override in .taskpilot/ but not TaskPilot's own workflow", () => {
    const dir = path.join(repo, ".taskpilot");
    expect(isAllowedPath(path.join(dir, "workflow.yml"), repo)).toBe(true);
    expect(isAllowedPath(path.join(dir, "investigate.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(dir, "sub", "x.md"), repo)).toBe(false);
    expect(isAllowedPath(path.join(dir, "run.sh"), repo)).toBe(false);
    expect(isAllowedPath(path.join(dir, "settings.yml"), repo)).toBe(true);
    expect(isAllowedPath(path.join(dir, "other.yml"), repo)).toBe(false);
    expect(isAllowedPath(path.join(dir, "sub", "settings.yml"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "workflow.yml"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "tasks", "A-1", "02-plan.md"), repo)).toBe(false);
    expect(isAllowedPath(path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml"), repo)).toBe(false);
    // Even with TaskPilot itself open as the repo.
    const taskpilot = path.resolve(DEFAULT_WORKFLOW_DIR, "../..");
    expect(isAllowedPath(path.join(DEFAULT_WORKFLOW_DIR, "investigate.md"), taskpilot)).toBe(false);
  });
});

describe("CLI capability", () => {
  it("defaults to Claude and rejects unknown CLI or scope", async () => {
    expect(configCli()).toBe("claude");
    expect(configCli("copilot")).toBe("copilot");
    expect(() => configCli("other")).toThrow();
    expect(() => requireConfigScope("codex", "hooks", "project")).toThrow();
    expect(() => markConfigAvailable("codex", "hooks")).toThrow();
    expect((await get("/api/config/capabilities")).cli).toBe("claude");
    const codex = await get("/api/config/capabilities?cli=codex");
    expect(codex.sections.memory).toMatchObject({ scopes: ["project", "user"], supported: true, available: true });
    expect(codex.sections.hooks).toMatchObject({ supported: false, available: false });
    expect((await app.inject({ url: "/api/config/capabilities?cli=other", headers: ok })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/config/memory?cli=codex", headers: ok })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/config/memory?cli=other", headers: ok })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/config/agents/templates?cli=codex", headers: ok })).statusCode).toBe(200);
    expect(configuredCodexHome()).toBe(codexHome);
    expect(configuredCopilotHome()).toBe(copilotHome);
  });
});

describe("writer symlink guard", () => {
  it("rejects a linked directory and file for each new CLI", async () => {
    const outside = await tempDir("taskpilot-outside-");
    const backups = new BackupStore(await tempDir("taskpilot-backups-"));
    for (const [cli, root, target] of [
      ["codex", codexHome, libraryTarget(repo, "skills", "user", "audit/SKILL.md", "codex")],
      ["copilot", copilotHome, libraryTarget(repo, "skills", "user", "audit/SKILL.md", "copilot")],
    ] as const) {
      await mkdir(path.join(root, "skills"), { recursive: true });
      await symlink(outside, path.join(root, "skills", "audit"));
      await expect(writeWithBackup({ repo, target, next: `# ${cli}\n`, baseHash: "absent", reason: "test", backups })).rejects.toMatchObject({ status: 409 });
      await expect(readFile(path.join(outside, "SKILL.md"), "utf8")).rejects.toThrow();
    }
    const target = settingsTarget(repo, "user", "codex");
    await symlink(path.join(outside, "config.toml"), target.abs);
    await expect(writeWithBackup({ repo, target, next: "model = 'x'\n", baseHash: "absent", reason: "test", backups })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a symlinked new CLI home root", async () => {
    const outside = await tempDir("taskpilot-outside-");
    const link = path.join(repo, "linked-codex-home");
    await symlink(outside, link);
    const old = process.env.TASKPILOT_CODEX_HOME;
    process.env.TASKPILOT_CODEX_HOME = link;
    try {
      const target = settingsTarget(repo, "user", "codex");
      const backups = new BackupStore(await tempDir("taskpilot-backups-"));
      await expect(writeWithBackup({ repo, target, next: "model = 'x'\n", baseHash: "absent", reason: "test", backups })).rejects.toMatchObject({ status: 409 });
      await expect(readFile(path.join(outside, "config.toml"), "utf8")).rejects.toThrow();
    } finally {
      process.env.TASKPILOT_CODEX_HOME = old;
    }
  });

  it("keeps hash checks, backup and atomic write for new targets", async () => {
    const backups = new BackupStore(await tempDir("taskpilot-backups-"));
    const target = memoryTarget(repo, "user", "copilot");
    const first = await writeWithBackup({ repo, target, next: "first\n", baseHash: "absent", reason: "test", backups });
    expect(first.hash).toBe(hashOf("first\n"));
    await expect(writeWithBackup({ repo, target, next: "stale\n", baseHash: "absent", reason: "test", backups })).rejects.toMatchObject({ status: 409 });
    const second = await writeWithBackup({ repo, target, next: "second\n", baseHash: first.hash, reason: "test", backups });
    expect(second.backup.existed).toBe(true);
    expect((await backups.get(second.backup.id)).content).toBe("first\n");
    expect(await readFile(target.abs, "utf8")).toBe("second\n");
  });
});

describe("libraryTarget", () => {
  it("accepts multi-level and dotted agent and command names inside the allowed folder", () => {
    for (const rel of ["a/b/c/d.md", "code.reviewer.md", "Agent Name.md", "git/v1.2/pr.md"]) {
      for (const kind of ["agents", "commands"] as const) {
        expect(isAllowedPath(libraryTarget(repo, kind, "project", rel).abs, repo)).toBe(true);
      }
    }
  });

  it("rejects empty, dot and parent segments, backslashes and control characters", () => {
    for (const rel of ["", "..", "../x.md", "a/../x.md", "a//b.md", "./x.md", "a/./b.md", "/abs.md", "a\\b.md", "a/b", "x\0.md", "a\n.md", ".md", "a/.md"]) {
      expect(() => libraryTarget(repo, "agents", "project", rel), rel).toThrow();
    }
  });
});
