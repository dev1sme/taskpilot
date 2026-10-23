import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CodexError } from "../../../src/core/codex/errors.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";
import { codexCommand, codexResumeOptions, codexThreadOptions } from "../../../src/core/codex/launch.js";

afterAll(cleanupTempDirs);
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

  describe("subagent", () => {
    const agentRepo = async (toml: string) => {
      const repo = await tempDir("codex-agent-");
      await mkdir(path.join(repo, ".codex", "agents"), { recursive: true });
      await writeFile(path.join(repo, ".codex", "agents", "worker.toml"), toml);
      return repo;
    };

    it("applies the agent's instructions and model", async () => {
      const repo = await agentRepo('name = "worker"\nmodel = "agent-model"\ndeveloper_instructions = "Be careful."\n');
      expect(codexThreadOptions({ cwd: repo, subagent: "worker" })).toEqual({ cwd: repo, model: "agent-model", developerInstructions: "Be careful." });
      expect(codexThreadOptions({ cwd: repo, subagent: "worker", model: "row-model" }).model).toBe("row-model");
      expect(codexResumeOptions({ cwd: repo, threadId: "t1", subagent: "worker" })).toMatchObject({ developerInstructions: "Be careful." });
    });

    it("keeps the session model when the agent has none", async () => {
      const repo = await agentRepo('developer_instructions = "x"\n');
      expect(codexThreadOptions({ cwd: repo, subagent: "worker" })).toEqual({ cwd: repo, developerInstructions: "x" });
    });

    it.each(["missing", "../worker", "bad name"])("refuses %s", async (subagent) => {
      const repo = await agentRepo('developer_instructions = "x"\n');
      expect(() => codexThreadOptions({ cwd: repo, subagent })).toThrowError(expect.objectContaining({ code: "subagentUnsupported" }));
    });

    it("refuses an agent without instructions or with broken TOML", async () => {
      for (const toml of ['name = "worker"\n', "= broken"]) {
        const repo = await agentRepo(toml);
        expect(() => codexThreadOptions({ cwd: repo, subagent: "worker" })).toThrowError(expect.objectContaining({ code: "subagentUnsupported" }));
      }
    });
  });

  it("passes approvalsReviewer and networkAccess only inside the workspace sandbox", () => {
    expect(codexThreadOptions({ cwd, permissionMode: "acceptEdits", approvalsReviewer: "auto_review", networkAccess: true })).toEqual({
      cwd,
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      config: { sandbox_workspace_write: { network_access: true } },
    });
    expect(codexThreadOptions({ cwd, permissionMode: "auto", networkAccess: false }).config).toEqual({ sandbox_workspace_write: { network_access: false } });
    expect(codexThreadOptions({ cwd, approvalsReviewer: "auto_review", networkAccess: true })).toEqual({ cwd });
    expect(codexThreadOptions({ cwd, permissionMode: "default", networkAccess: true })).toEqual({ cwd });
  });

  it("refuses unknown reviewers and non-boolean network values", () => {
    for (const approvalsReviewer of ["guardian_subagent", "", "yes"]) {
      expect(() => codexThreadOptions({ cwd, permissionMode: "acceptEdits", approvalsReviewer: approvalsReviewer as never }), approvalsReviewer).toThrowError(
        expect.objectContaining({ code: "modeUnsupported" }),
      );
    }
    expect(() => codexThreadOptions({ cwd, permissionMode: "acceptEdits", networkAccess: "true" as never })).toThrowError(expect.objectContaining({ code: "modeUnsupported" }));
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

  it("repeats approvalsReviewer and networkAccess on resume", () => {
    const r = codexResumeOptions({ cwd: "/repo", threadId: "t1", permissionMode: "acceptEdits", approvalsReviewer: "auto_review", networkAccess: true });
    expect(r).toMatchObject({ approvalsReviewer: "auto_review", config: { sandbox_workspace_write: { network_access: true } } });
  });

  it("fails without a thread id instead of starting a new thread", () => {
    expect(() => codexResumeOptions({ cwd: "/repo", threadId: undefined })).toThrowError(CodexError);
    expect(() => codexResumeOptions({ cwd: "/repo", threadId: "" })).toThrowError(expect.objectContaining({ code: "noThread" }));
  });
});
