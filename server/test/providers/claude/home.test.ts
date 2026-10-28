import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeHome, claudeJson } from "../../../src/providers/claude/home.js";

describe("claude home", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to ~/.claude and ~/.claude.json, TASKPILOT_* overrides", () => {
    vi.stubEnv("TASKPILOT_CLAUDE_HOME", "");
    vi.stubEnv("TASKPILOT_CLAUDE_JSON", "");
    expect(claudeHome()).toBe(path.join(homedir(), ".claude"));
    expect(claudeJson()).toBe(path.join(homedir(), ".claude.json"));
    vi.stubEnv("TASKPILOT_CLAUDE_HOME", "/tp/claude");
    vi.stubEnv("TASKPILOT_CLAUDE_JSON", "/tp/claude.json");
    expect(claudeHome()).toBe("/tp/claude");
    expect(claudeJson()).toBe("/tp/claude.json");
  });
});
