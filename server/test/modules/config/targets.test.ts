import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedPath, libraryTarget } from "../../../src/modules/config/shared/targets.js";
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
