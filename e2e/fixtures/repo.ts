import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { TMP } from "../env";

/**
 * A small repo with native configuration for Claude, Copilot and Codex. It includes permissions, a hook, a skill with
 * wide content, an agent and an MCP server that also exist in a higher-priority scope, plus an agent with a
 * very long name and an MCP server with many arguments (for the layout regression tests).
 */
export const LONG_AGENT = "taskpilot-implementer-with-a-very-long-descriptive-name";
export const LONG_MCP = "taskpilot-codegraph-server-with-a-long-name";
export const FIXTURE_REPO = path.join(TMP, "repos", "fixture-repo");

const FILES: Record<string, string> = {
  "CLAUDE.md": "# Fixture repo\n- Dùng TypeScript strict.\n",
  "AGENTS.md": "# Codex fixture\n- Chỉ dẫn riêng cho Codex.\n",
  ".github/copilot-instructions.md": "# Copilot fixture\n- Chỉ dẫn riêng cho Copilot.\n",
  ".codex/config.toml": 'approval_policy = "on-request"\n[mcp_servers.codex-docs]\nurl = "https://codex.example/mcp"\n',
  ".github/copilot/settings.json": JSON.stringify({ disableAllHooks: false, future: { keep: true } }),
  ".github/hooks/fixture.json": JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", command: "echo fixture" }] } }),
  ".codex/hooks.json": JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo codex-fixture", timeout: 5 }] }] } }),
  ".codex/agents/native-reviewer.toml": 'name = "native-reviewer"\ndescription = "Review cho Codex"\ndeveloper_instructions = "Review code."\n',
  ".github/agents/native-reviewer.agent.md": "---\nname: native-reviewer\ndescription: Review cho Copilot\n---\n\nReview code.\n",
  ".github/mcp.json": JSON.stringify({ mcpServers: { "copilot-docs": { type: "http", url: "https://copilot.example/mcp", headers: { Authorization: "e2e-secret-copilot" } } } }),
  ".claude/tasks/PROJ-1/spec/README.md": "# Thêm trang đăng nhập bằng OAuth\n",
  ".claude/skills/long-skill/SKILL.md": [
    "---",
    "name: long-skill",
    "description: Skill có nội dung rộng hơn khung",
    "---",
    "",
    "# long-skill",
    "",
    "```bash",
    `npx some-tool ${"--flag-with-a-long-name ".repeat(20)}`,
    "```",
    "",
    "| Lệnh | Mô tả | Ví dụ | Ghi chú | Mặc định | Phiên bản |",
    "|---|---|---|---|---|---|",
    `| ${"cột-rất-dài ".repeat(6)} | ${"mô tả ".repeat(12)} | \`${"x".repeat(60)}\` | ghi chú | không | 1.0 |`,
    "",
    `Xem https://example.com/${"a-very-long-path-segment/".repeat(10)} và \`${"inline-code-".repeat(15)}\`.`,
    "",
  ].join("\n"),
  ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Review của repo\n---\n\nReview code.\n",
  [`.claude/agents/${LONG_AGENT}.md`]: `---\nname: ${LONG_AGENT}\ndescription: Agent có tên rất dài để thử bố cục danh sách\ntools: Read, Edit, Write, Bash\n---\n\nImplement.\n`,
  ".mcp.json": JSON.stringify({
    mcpServers: {
      docs: { type: "http", url: "https://docs.example/mcp" },
      [LONG_MCP]: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@example/some-long-package-name@latest", "--root", "/very/long/path/to/the/workspace/root", "--config", "./config/server.json", "--verbose", "--log-level", "debug"],
      },
    },
  }),
  ".claude/settings.json": JSON.stringify({
    permissions: { allow: ["Bash(npm test:*)"], deny: ["Bash(rm -rf:*)"] },
    hooks: { PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier --write ." }] }] },
  }),
};

/** Files under e2e/.tmp, which stands in for ~/.claude and ~/.claude.json of the app under test. */
const HOME_FILES: Record<string, string> = {
  // Project agents win over user agents: this one is hidden by the repo's reviewer.
  "claude/agents/reviewer.md": "---\nname: reviewer\ndescription: Review của ba\n---\n\nReview code.\n",
  // Local MCP servers win over .mcp.json: the repo's docs server is hidden by this one.
  "claude.json": JSON.stringify({ projects: { [FIXTURE_REPO]: { mcpServers: { docs: { type: "http", url: "https://local.example/mcp" } } } } }),
};

/** Writes the fixture repo (idempotent, so parallel tests can share it) and opens it in the app. */
export async function openFixtureRepo(page: Page): Promise<void> {
  const files = [
    ...Object.entries(FILES).map(([rel, content]) => [path.join(FIXTURE_REPO, rel), content]),
    ...Object.entries(HOME_FILES).map(([rel, content]) => [path.join(TMP, rel), content]),
  ];
  for (const [file, content] of files) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const res = await page.request.put("/api/repo", { data: { path: FIXTURE_REPO } });
  expect(res.ok()).toBe(true);
}

/** Isolated selection fixtures: same task keys in distinct repos, mode-only settings and optional override. */
export function createSelectionRepo(name: string, options: { settings?: string; workflow?: string } = {}): string {
  const repo = path.join(TMP, "repos", `selection-${name}`);
  const files = {
    ".claude/tasks/DEMO-1/spec/README.md": "# Selection fixture\n",
    ".claude/tasks/DEMO-2/spec/README.md": "# Second selection task\n",
    ".taskpilot/settings.yml": options.settings ?? "# mode-only legacy settings\nmode: solo\nfuture: { keep: true }\n",
    ...(options.workflow ? { ".taskpilot/workflow.yml": options.workflow, ".taskpilot/prompt.md": "WRITE:.claude/tasks/DEMO-1/02-plan.md {{outputs}}" } : {}),
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(repo, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return repo;
}
