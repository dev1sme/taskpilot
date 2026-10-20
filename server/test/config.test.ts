import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLibrary } from "../src/config/library.js";
import { readMcp } from "../src/config/mcp.js";
import { readMemory } from "../src/config/memory.js";
import { readHooks, readSettings } from "../src/config/settings.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

let repo: string;
let home: string;
const saved = { ...process.env };

beforeAll(async () => {
  repo = await makeRepo();
  home = await tempDir("taskpilot-home-");
  process.env.TASKPILOT_CLAUDE_HOME = home;
  process.env.TASKPILOT_CLAUDE_JSON = path.join(home, "claude.json");
  delete process.env.MISSING_TOKEN;
  delete process.env.MISSING_KEY;
  process.env.SET_TOKEN = "x";

  await writeFile(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await writeFile(path.join(repo, "docs", "testing.md"), "Testing guide @../nested.md\n");
  await writeFile(path.join(repo, "nested.md"), "nested\n");
  await writeFile(
    path.join(repo, "CLAUDE.md"),
    [
      "# Repo",
      "## Testing",
      "Run npm run test and npm run e2e.",
      "@docs/testing.md @missing.md",
      "Mail me at a@b.com, ping @alice.",
      "```",
      "@inside/code.md",
      "```",
      "token sk-abcdefghijklmnopqrstuvwxyz123",
      "",
      "Setext title",
      "===",
      "~~~",
      "## Not a heading",
      "~~~",
    ].join("\n"),
  );
  await writeFile(path.join(home, "CLAUDE.md"), "# Global\n");

  const claude = path.join(repo, ".claude");
  await writeFile(
    path.join(claude, "settings.json"),
    JSON.stringify({
      permissions: { allow: ["Read", "Bash(npm test)"], deny: ["Bash(rm *)"], defaultMode: "acceptEdits" },
      env: { API_TOKEN: "secret-value", REF: "${HOME}" },
      hooks: { PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier -w", timeout: 30 }] }] },
      model: "opus",
    }),
  );
  await writeFile(path.join(claude, "settings.local.json"), "{ broken");

  await mkdir(path.join(claude, "agents"), { recursive: true });
  await writeFile(path.join(claude, "agents", "rev.md"), "---\nname: reviewer\ndescription: Reviews diffs\ntools: Read, Grep\nmodel: sonnet\n---\nYou review code.\n");
  await mkdir(path.join(claude, "commands", "git"), { recursive: true });
  await writeFile(path.join(claude, "commands", "git", "pr.md"), "---\nargument-hint: [title]\n---\nOpen a PR\n");
  await mkdir(path.join(claude, "skills", "deploy", "scripts"), { recursive: true });
  await writeFile(path.join(claude, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship it\n---\nSteps\n");
  await writeFile(path.join(claude, "skills", "deploy", "scripts", "run.sh"), "echo\n");
  await mkdir(path.join(home, "agents"), { recursive: true });
  await writeFile(path.join(home, "agents", "global.md"), "No frontmatter here\n");

  await writeFile(
    path.join(repo, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        sentry: { command: "npx", args: ["-y", "@sentry/mcp", "postgresql://app:hunter2@db/shop"], env: { SENTRY_TOKEN: "${MISSING_TOKEN}", ORG: "acme" } },
        api: { type: "http", url: "https://x/${SET_TOKEN}", headers: { Authorization: "Bearer abc", "X-Key": "Bearer ${MISSING_KEY}" } },
      },
    }),
  );
  await writeFile(
    path.join(home, "claude.json"),
    JSON.stringify({ mcpServers: { github: { type: "http", url: "https://gh" } }, projects: { [repo]: { mcpServers: { pg: { command: "pg-mcp" } } } }, oauthAccount: { secret: 1 } }),
  );
});

afterAll(async () => {
  process.env = saved;
  await cleanupTempDirs();
});

describe("readMemory", () => {
  it("lists headings, resolves imports recursively and flags problems", async () => {
    const [project, local, user] = await readMemory(repo);
    expect(project.headings).toEqual([
      { level: 1, text: "Repo", line: 1 },
      { level: 2, text: "Testing", line: 2 },
      { level: 1, text: "Setext title", line: 11 },
    ]);
    expect(project.imports.map((i) => [i.ref, i.exists, i.depth])).toEqual([
      ["docs/testing.md", true, 1],
      ["../nested.md", true, 2],
      ["missing.md", false, 1],
    ]);
    const warnings = project.checks.filter((c) => c.level === "warn").map((c) => c.message);
    expect(warnings).toEqual([
      "Không tìm thấy missing.md",
      'Nhắc "npm run e2e" nhưng package.json không có script này',
      "Có thể chứa khoá API dạng sk-…; file này được nạp vào mọi session",
    ]);
    expect(local.exists).toBe(false);
    expect(user).toMatchObject({ exists: true, content: "# Global\n" });
  });
});

describe("readSettings / readHooks", () => {
  it("returns permissions per scope, masks env values, reports broken JSON", async () => {
    const [project, local, user] = await readSettings(repo);
    expect(project).toMatchObject({
      allow: ["Read", "Bash(npm test)"],
      deny: ["Bash(rm *)"],
      defaultMode: "acceptEdits",
      otherKeys: ["model"],
      env: [
        { key: "API_TOKEN", value: "••••", reference: false },
        { key: "REF", value: "${HOME}", reference: true },
      ],
    });
    expect(JSON.stringify(project)).not.toContain("secret-value");
    expect(local.error).toMatch(/JSON/);
    expect(user.exists).toBe(false);
  });

  it("flattens hooks", async () => {
    expect(await readHooks(repo)).toEqual([
      expect.objectContaining({ scope: "project", event: "PostToolUse", matcher: "Edit|Write", command: "npx prettier -w", timeout: 30 }),
    ]);
  });
});

describe("readLibrary", () => {
  it("reads agents with frontmatter, project before user", async () => {
    const agents = await readLibrary(repo, "agents");
    expect(agents.map((a) => [a.scope, a.name, a.description])).toEqual([
      ["project", "reviewer", "Reviews diffs"],
      ["user", "global", "No frontmatter here"],
    ]);
    expect(agents[0].fields).toEqual([
      { key: "tools", value: "Read, Grep" },
      { key: "model", value: "sonnet" },
    ]);
  });

  it("namespaces commands by folder and lists skill files", async () => {
    expect((await readLibrary(repo, "commands")).map((c) => c.name)).toEqual(["git:pr"]);
    const [skill] = await readLibrary(repo, "skills");
    expect(skill).toMatchObject({ name: "deploy", description: "Ship it", files: ["scripts/run.sh"] });
  });
});

describe("readMcp", () => {
  it("merges project, local and user servers and never exposes secrets", async () => {
    const mcp = await readMcp(repo);
    expect(mcp.servers.map((s) => [s.scope, s.name, s.type])).toEqual([
      ["project", "sentry", "stdio"],
      ["project", "api", "http"],
      ["local", "pg", "stdio"],
      ["user", "github", "http"],
    ]);
    const sentry = mcp.servers[0];
    expect(sentry.missingEnv).toEqual(["MISSING_TOKEN"]);
    expect(sentry.args).toEqual(["-y", "@sentry/mcp", "postgresql://••••@db/shop"]);
    expect(sentry.env).toEqual([
      { key: "SENTRY_TOKEN", value: "${MISSING_TOKEN}", reference: true },
      { key: "ORG", value: "••••", reference: false },
    ]);
    expect(mcp.servers[1]).toMatchObject({
      missingEnv: ["MISSING_KEY"],
      headers: [
        { key: "Authorization", value: "••••", reference: false },
        { key: "X-Key", value: "Bearer ${MISSING_KEY}", reference: true },
      ],
    });
    expect(JSON.stringify(mcp)).not.toMatch(/Bearer abc|oauthAccount|hunter2/);
  });
});
