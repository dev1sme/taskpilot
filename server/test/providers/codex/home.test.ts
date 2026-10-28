import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codexConfigHome, codexHome, codexSkillsHome } from "../../../src/providers/codex/home.js";

const DEFAULT = path.join(homedir(), ".codex");

describe("codex home", () => {
  beforeEach(() => {
    vi.stubEnv("CODEX_HOME", "");
    vi.stubEnv("TASKPILOT_CODEX_HOME", "");
    vi.stubEnv("TASKPILOT_CODEX_SKILLS_HOME", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("CLI home is CODEX_HOME, else ~/.codex", () => {
    expect(codexHome()).toBe(DEFAULT);
    vi.stubEnv("CODEX_HOME", "/cli/codex");
    expect(codexHome()).toBe("/cli/codex");
  });

  it("ignores TASKPILOT_CODEX_HOME for the CLI home", () => {
    vi.stubEnv("TASKPILOT_CODEX_HOME", "/tp/codex");
    expect(codexHome()).toBe(DEFAULT);
  });

  it("config home is TASKPILOT_CODEX_HOME, then CODEX_HOME, then ~/.codex", () => {
    expect(codexConfigHome()).toBe(DEFAULT);
    vi.stubEnv("CODEX_HOME", "/cli/codex");
    expect(codexConfigHome()).toBe("/cli/codex");
    vi.stubEnv("TASKPILOT_CODEX_HOME", "/tp/codex");
    expect(codexConfigHome()).toBe("/tp/codex");
  });

  it("skills home is TASKPILOT_CODEX_SKILLS_HOME, else ~/.agents/skills, independent of CODEX_HOME", () => {
    vi.stubEnv("CODEX_HOME", "/cli/codex");
    expect(codexSkillsHome()).toBe(path.join(homedir(), ".agents", "skills"));
    vi.stubEnv("TASKPILOT_CODEX_SKILLS_HOME", "/tp/skills");
    expect(codexSkillsHome()).toBe("/tp/skills");
  });
});
