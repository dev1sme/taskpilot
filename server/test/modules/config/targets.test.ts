import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedPath } from "../../../src/modules/config/shared/targets.js";
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
});
