import { afterEach, describe, expect, it } from "vitest";
import { CodexError } from "../../../src/core/codex/errors.js";
import { codexCommand, codexResumeOptions, codexThreadOptions } from "../../../src/core/codex/launch.js";

afterEach(() => {
  delete process.env.TASKPILOT_CODEX;
});

describe("codexCommand", () => {
  it("starts one app-server on stdio, from TASKPILOT_CODEX when set", () => {
    expect(codexCommand()).toEqual({ file: "codex", args: ["app-server", "--listen", "stdio://"] });
    process.env.TASKPILOT_CODEX = "/opt/fake-codex";
    expect(codexCommand().file).toBe("/opt/fake-codex");
  });
});

describe("codexThreadOptions", () => {
  const cwd = "/repo";

  it("leaves sandbox and approval to the user's config for default and no mode", () => {
    expect(codexThreadOptions({ cwd })).toEqual({ cwd });
    expect(codexThreadOptions({ cwd, permissionMode: "default" })).toEqual({ cwd });
  });

  it("maps acceptEdits and auto to the workspace sandbox", () => {
    expect(codexThreadOptions({ cwd, permissionMode: "acceptEdits" })).toEqual({ cwd, sandbox: "workspace-write", approvalPolicy: "on-request" });
    expect(codexThreadOptions({ cwd, permissionMode: "auto" })).toEqual({ cwd, sandbox: "workspace-write", approvalPolicy: "never" });
  });

  it("passes the model", () => {
    expect(codexThreadOptions({ cwd, model: "gpt-6.1-sol" })).toEqual({ cwd, model: "gpt-6.1-sol" });
  });

  it("refuses plan and unknown modes", () => {
    for (const permissionMode of ["plan", "bypassPermissions", "danger-full-access", ""]) {
      expect(() => codexThreadOptions({ cwd, permissionMode }), permissionMode).toThrowError(expect.objectContaining({ code: "modeUnsupported" }));
    }
  });

  it("refuses a subagent", () => {
    expect(() => codexThreadOptions({ cwd, subagent: "taskpilot-implementer" })).toThrowError(expect.objectContaining({ code: "subagentUnsupported" }));
  });

  it("never asks for full access, whatever the mode", () => {
    for (const permissionMode of [undefined, "default", "acceptEdits", "auto"]) {
      expect(JSON.stringify(codexThreadOptions({ cwd, permissionMode }))).not.toMatch(/danger|full-access|dangerously/);
    }
  });
});

describe("codexResumeOptions", () => {
  it("repeats the settings with the thread id and without the old turns", () => {
    expect(codexResumeOptions({ cwd: "/repo", threadId: "t1", permissionMode: "auto", model: "m" })).toEqual({
      threadId: "t1",
      cwd: "/repo",
      model: "m",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      excludeTurns: true,
    });
  });

  it("fails without a thread id instead of starting a new thread", () => {
    expect(() => codexResumeOptions({ cwd: "/repo", threadId: undefined })).toThrowError(CodexError);
    expect(() => codexResumeOptions({ cwd: "/repo", threadId: "" })).toThrowError(expect.objectContaining({ code: "noThread" }));
  });
});
