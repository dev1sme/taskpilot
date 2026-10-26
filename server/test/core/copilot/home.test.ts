import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copilotConfigHome, copilotHome } from "../../../src/core/copilot/home.js";

const DEFAULT = path.join(homedir(), ".copilot");

describe("copilot home", () => {
  beforeEach(() => {
    vi.stubEnv("COPILOT_HOME", "");
    vi.stubEnv("TASKPILOT_COPILOT_HOME", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("CLI home is COPILOT_HOME, else ~/.copilot", () => {
    expect(copilotHome()).toBe(DEFAULT);
    vi.stubEnv("COPILOT_HOME", "/cli/copilot");
    expect(copilotHome()).toBe("/cli/copilot");
  });

  it("ignores TASKPILOT_COPILOT_HOME for the CLI home", () => {
    vi.stubEnv("TASKPILOT_COPILOT_HOME", "/tp/copilot");
    expect(copilotHome()).toBe(DEFAULT);
  });

  it("config home is TASKPILOT_COPILOT_HOME, then COPILOT_HOME, then ~/.copilot", () => {
    expect(copilotConfigHome()).toBe(DEFAULT);
    vi.stubEnv("COPILOT_HOME", "/cli/copilot");
    expect(copilotConfigHome()).toBe("/cli/copilot");
    vi.stubEnv("TASKPILOT_COPILOT_HOME", "/tp/copilot");
    expect(copilotConfigHome()).toBe("/tp/copilot");
  });

  it("treats an empty value as not set, never a relative path", () => {
    vi.stubEnv("TASKPILOT_COPILOT_HOME", "");
    vi.stubEnv("COPILOT_HOME", "");
    expect(path.isAbsolute(copilotConfigHome())).toBe(true);
    expect(copilotConfigHome()).toBe(DEFAULT);
  });
});
