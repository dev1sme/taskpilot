import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { TMP } from "../env";

/** A small repo with one task, CLAUDE.md, permissions (long user path included) and a hook. */
export const FIXTURE_REPO = path.join(TMP, "repos", "fixture-repo");

const FILES: Record<string, string> = {
  "CLAUDE.md": "# Fixture repo\n- Dùng TypeScript strict.\n",
  ".claude/tasks/PROJ-1/spec/README.md": "# Thêm trang đăng nhập bằng OAuth\n",
  ".claude/settings.json": JSON.stringify({
    permissions: { allow: ["Bash(npm test:*)"], deny: ["Bash(rm -rf:*)"] },
    hooks: { PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier --write ." }] }] },
  }),
};

/** Writes the fixture repo (idempotent, so parallel tests can share it) and opens it in the app. */
export async function openFixtureRepo(page: Page): Promise<void> {
  for (const [rel, content] of Object.entries(FILES)) {
    const file = path.join(FIXTURE_REPO, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const res = await page.request.put("/api/repo", { data: { path: FIXTURE_REPO } });
  expect(res.ok()).toBe(true);
}
