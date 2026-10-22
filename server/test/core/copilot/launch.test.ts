import { describe, expect, it } from "vitest";
import { copilotLauncher } from "../../../src/core/copilot/launch.js";

describe("copilotLauncher", () => {
  it("uses --session-id for both a new session and a resume", () => {
    expect(copilotLauncher("s1", { resume: false }).args).toEqual(["--session-id", "s1"]);
    expect(copilotLauncher("s1", { resume: true }).args).toEqual(["--session-id", "s1"]);
  });

  it("maps each workflow permission-mode to Copilot flags", () => {
    const args = (permissionMode: string) => copilotLauncher("s1", { resume: false, permissionMode }).args.slice(2);
    expect(args("default")).toEqual([]);
    expect(args("acceptEdits")).toEqual(["--allow-tool=write"]);
    expect(args("plan")).toEqual(["--mode", "plan"]);
    expect(args("auto")).toEqual([]);
  });

  it("marks every session as TaskPilot's and allows all tools only in auto mode", () => {
    const env = (permissionMode?: string) => copilotLauncher("s1", { resume: false, permissionMode }).env;
    expect(env("auto")).toEqual({ TASKPILOT_HOOK_AGENT: "copilot", COPILOT_ALLOW_ALL: "true" });
    for (const mode of ["default", "acceptEdits", "plan", undefined]) expect(env(mode)).toEqual({ TASKPILOT_HOOK_AGENT: "copilot" });
  });

  it("passes --agent and --model after the permission flags", () => {
    expect(copilotLauncher("s1", { resume: true, permissionMode: "plan", subagent: "reviewer", model: "gpt-5.4" }).args).toEqual([
      "--session-id",
      "s1",
      "--mode",
      "plan",
      "--agent",
      "reviewer",
      "--model",
      "gpt-5.4",
    ]);
  });

  it("ignores --settings, which copilot does not have", () => {
    expect(copilotLauncher("s1", { resume: false, settings: "{}" }).args).not.toContain("--settings");
  });
});
