import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { TMP } from "../env";

/**
 * A small repo with one task, CLAUDE.md, permissions (long user path included), a hook, a skill with
 * wide content, and an agent and an MCP server that also exist in a higher-priority scope.
 */
export const FIXTURE_REPO = path.join(TMP, "repos", "fixture-repo");

const FILES: Record<string, string> = {
  "CLAUDE.md": "# Fixture repo\n- Dùng TypeScript strict.\n",
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
  ".mcp.json": JSON.stringify({ mcpServers: { docs: { type: "http", url: "https://docs.example/mcp" } } }),
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
