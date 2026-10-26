import { describe, expect, it } from "vitest";
import { claudeLauncher } from "../../../src/core/claude/launch.js";
import { childEnv } from "../../../src/core/launch.js";

describe("claudeLauncher", () => {
  it("runs the session as a subagent with a model, on start and again on resume", () => {
    const opts = { permissionMode: "auto", subagent: "taskpilot-implementer", model: "haiku" };
    expect(claudeLauncher("s1", { resume: false, ...opts }).args).toEqual(["--session-id", "s1", "--permission-mode", "auto", "--agent", "taskpilot-implementer", "--model", "haiku"]);
    expect(claudeLauncher("s1", { resume: true, ...opts }).args).toEqual(["--resume", "s1", "--permission-mode", "auto", "--agent", "taskpilot-implementer", "--model", "haiku"]);
  });

  it("adds neither flag when the session has no model or subagent", () => {
    expect(claudeLauncher("s1", { resume: false }).args).toEqual(["--session-id", "s1"]);
    expect(claudeLauncher("s1", { resume: false, model: "opus" }).args).toEqual(["--session-id", "s1", "--model", "opus"]);
  });
});

describe("childEnv", () => {
  it("drops CLAUDE* variables so the child writes its transcript", () => {
    const env = childEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", HOME: "/h" });
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h" });
    expect(Object.keys(env).filter((k) => k.startsWith("CLAUDE"))).toEqual([]);
  });
});
