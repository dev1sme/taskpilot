import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedPath } from "../../../src/modules/config/shared/targets.js";
import { DEFAULT_WORKFLOW_DIR } from "../../../src/modules/workflow/definition.js";
import { home, repo, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

describe("isAllowedPath", () => {
  it("allows only Claude config files", () => {
    expect(isAllowedPath(path.join(repo, "CLAUDE.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(repo, ".claude", "agents", "a.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(home, "skills", "x", "run.sh"), repo)).toBe(true);
    expect(isAllowedPath(path.join(repo, ".claude", "agents"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, "src", "index.ts"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "agents", "..", "..", "package.json"), repo)).toBe(false);
    expect(isAllowedPath("/etc/passwd", repo)).toBe(false);
  });

  it("allows the workflow override in .claude/taskpilot/ but not TaskPilot's own workflow", () => {
    const dir = path.join(repo, ".claude", "taskpilot");
    expect(isAllowedPath(path.join(dir, "workflow.yml"), repo)).toBe(true);
    expect(isAllowedPath(path.join(dir, "investigate.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(dir, "sub", "x.md"), repo)).toBe(false);
    expect(isAllowedPath(path.join(dir, "run.sh"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "workflow.yml"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "tasks", "A-1", "02-plan.md"), repo)).toBe(false);
    expect(isAllowedPath(path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml"), repo)).toBe(false);
    // Even with TaskPilot itself open as the repo.
    const taskpilot = path.resolve(DEFAULT_WORKFLOW_DIR, "../..");
    expect(isAllowedPath(path.join(DEFAULT_WORKFLOW_DIR, "investigate.md"), taskpilot)).toBe(false);
  });
});
