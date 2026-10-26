import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CodexError } from "../../../src/core/codex/errors.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";
import { parse as parseToml } from "smol-toml";
import { codexAppServerCommand, codexLauncher, codexLaunchSettings } from "../../../src/core/codex/launch.js";

afterAll(cleanupTempDirs);
afterEach(() => {
  delete process.env.TASKPILOT_CODEX;
});

describe("codexAppServerCommand", () => {
  it("starts one app-server on stdio, from TASKPILOT_CODEX when set", () => {
    delete process.env.TASKPILOT_CODEX; // vitest.config.ts points it at no binary
    expect(codexAppServerCommand()).toEqual({ file: "codex", args: ["app-server", "--listen", "stdio://"] });
    process.env.TASKPILOT_CODEX = "/opt/fake-codex";
    expect(codexAppServerCommand().file).toBe("/opt/fake-codex");
  });
});

describe("codexLaunchSettings", () => {
  const cwd = "/repo";

  it("leaves sandbox and approval to the user's config for default and no mode", () => {
    expect(codexLaunchSettings({ cwd })).toEqual({ cwd });
    expect(codexLaunchSettings({ cwd, permissionMode: "default" })).toEqual({ cwd });
  });

  it("maps acceptEdits and auto to the workspace sandbox", () => {
    expect(codexLaunchSettings({ cwd, permissionMode: "acceptEdits" })).toEqual({ cwd, sandbox: "workspace-write", approvalPolicy: "on-request" });
    expect(codexLaunchSettings({ cwd, permissionMode: "auto" })).toEqual({ cwd, sandbox: "workspace-write", approvalPolicy: "never" });
  });

  it("passes the model", () => {
    expect(codexLaunchSettings({ cwd, model: "gpt-6.1-sol" })).toEqual({ cwd, model: "gpt-6.1-sol" });
  });

  it("refuses plan and unknown modes", () => {
    for (const permissionMode of ["plan", "bypassPermissions", "danger-full-access", ""]) {
      expect(() => codexLaunchSettings({ cwd, permissionMode }), permissionMode).toThrowError(expect.objectContaining({ code: "modeUnsupported" }));
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
      expect(codexLaunchSettings({ cwd: repo, subagent: "worker" })).toEqual({ cwd: repo, model: "agent-model", developerInstructions: "Be careful." });
      expect(codexLaunchSettings({ cwd: repo, subagent: "worker", model: "row-model" }).model).toBe("row-model");
    });

    it("keeps the session model when the agent has none", async () => {
      const repo = await agentRepo('developer_instructions = "x"\n');
      expect(codexLaunchSettings({ cwd: repo, subagent: "worker" })).toEqual({ cwd: repo, developerInstructions: "x" });
    });

    it.each(["missing", "../worker", "bad name"])("refuses %s", async (subagent) => {
      const repo = await agentRepo('developer_instructions = "x"\n');
      expect(() => codexLaunchSettings({ cwd: repo, subagent })).toThrowError(expect.objectContaining({ code: "subagentUnsupported" }));
    });

    it("refuses an agent without instructions or with broken TOML", async () => {
      for (const toml of ['name = "worker"\n', "= broken"]) {
        const repo = await agentRepo(toml);
        expect(() => codexLaunchSettings({ cwd: repo, subagent: "worker" })).toThrowError(expect.objectContaining({ code: "subagentUnsupported" }));
      }
    });
  });

  it("passes approvalsReviewer and networkAccess only inside the workspace sandbox", () => {
    expect(codexLaunchSettings({ cwd, permissionMode: "acceptEdits", approvalsReviewer: "auto_review", networkAccess: true })).toEqual({
      cwd,
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      config: { sandbox_workspace_write: { network_access: true } },
    });
    expect(codexLaunchSettings({ cwd, permissionMode: "auto", networkAccess: false }).config).toEqual({ sandbox_workspace_write: { network_access: false } });
    expect(codexLaunchSettings({ cwd, approvalsReviewer: "auto_review", networkAccess: true })).toEqual({ cwd });
    expect(codexLaunchSettings({ cwd, permissionMode: "default", networkAccess: true })).toEqual({ cwd });
  });

  it("refuses unknown reviewers and non-boolean network values", () => {
    for (const approvalsReviewer of ["guardian_subagent", "", "yes"]) {
      expect(() => codexLaunchSettings({ cwd, permissionMode: "acceptEdits", approvalsReviewer: approvalsReviewer as never }), approvalsReviewer).toThrowError(
        expect.objectContaining({ code: "modeUnsupported" }),
      );
    }
    expect(() => codexLaunchSettings({ cwd, permissionMode: "acceptEdits", networkAccess: "true" as never })).toThrowError(expect.objectContaining({ code: "modeUnsupported" }));
  });

  it("never asks for full access, whatever the mode", () => {
    for (const permissionMode of [undefined, "default", "acceptEdits", "auto"]) {
      expect(JSON.stringify(codexLaunchSettings({ cwd, permissionMode }))).not.toMatch(/danger|full-access|dangerously/);
    }
  });
});

describe("codexLauncher", () => {
  const HOOKS = JSON.stringify({ Stop: 'echo "stop" \\ done', SessionStart: "echo start" });
  const run = (opts: Parameters<typeof codexLauncher>[1], id = "s1") => codexLauncher(id, { repo: "/repo", ...opts });

  it("starts the TUI without the shared daemon or update dialog, from TASKPILOT_CODEX when set", () => {
    process.env.TASKPILOT_CODEX = "/opt/fake-codex";
    expect(run({ resume: false })).toEqual({
      file: "/opt/fake-codex",
      args: ["--no-daemon", "-c", "check_for_update_on_startup=false"],
      env: { TASKPILOT_HOOK_AGENT: "codex" },
    });
    delete process.env.TASKPILOT_CODEX;
    expect(run({ resume: false }).file).toBe("codex");
  });

  it("keeps the user's sandbox and approval for default and no mode", () => {
    for (const permissionMode of [undefined, "default"]) expect(run({ resume: false, permissionMode }).args).toEqual(["--no-daemon", "-c", "check_for_update_on_startup=false"]);
  });

  it("maps acceptEdits and auto to the workspace sandbox", () => {
    expect(run({ resume: false, permissionMode: "acceptEdits" }).args).toEqual(["--no-daemon", "-c", "check_for_update_on_startup=false", "-s", "workspace-write", "-a", "on-request"]);
    expect(run({ resume: false, permissionMode: "auto", model: "gpt-6.1-sol" }).args).toEqual([
      "--no-daemon",
      "-c",
      "check_for_update_on_startup=false",
      "-m",
      "gpt-6.1-sol",
      "-s",
      "workspace-write",
      "-a",
      "never",
    ]);
  });

  it("passes approvalsReviewer and networkAccess only inside the sandbox", () => {
    const codex = { approvalsReviewer: "auto_review" as const, networkAccess: true };
    const args = run({ resume: false, permissionMode: "acceptEdits", codex }).args;
    expect(args).toContain('approvals_reviewer="auto_review"');
    expect(args).toContain("sandbox_workspace_write.network_access=true");
    const plain = run({ resume: false, permissionMode: "default", codex }).args.join(" ");
    expect(plain).not.toMatch(/approvals_reviewer|network_access/);
  });

  it("refuses plan and unknown modes", () => {
    for (const permissionMode of ["plan", "danger-full-access"]) {
      expect(() => run({ resume: false, permissionMode }), permissionMode).toThrowError(expect.objectContaining({ code: "modeUnsupported" }));
    }
  });

  it("never asks for full access or to skip hook trust", () => {
    for (const permissionMode of [undefined, "default", "acceptEdits", "auto"]) {
      expect(JSON.stringify(run({ resume: false, permissionMode, settings: HOOKS }))).not.toMatch(/danger|full-access|bypass/);
    }
  });

  it("declares each hook as a per-run -c entry that Codex reads back as the same command", () => {
    const { args } = run({ resume: false, settings: HOOKS });
    const hooks = args.filter((a) => a.startsWith("hooks."));
    expect(hooks).toHaveLength(2);
    const stop = hooks.find((a) => a.startsWith("hooks.Stop="))!;
    expect(parseToml(`hooks = ${stop.slice("hooks.Stop=".length)}`)).toEqual({ hooks: [{ hooks: [{ type: "command", command: 'echo "stop" \\ done' }] }] });
    expect(args.indexOf(stop) - 1).toBe(args.indexOf("-c", args.indexOf(stop) - 1));
  });

  describe("resume", () => {
    it("resumes the thread by id and repeats every setting", () => {
      const { args } = run({ resume: true, nativeId: "01a1-thread", permissionMode: "auto", model: "m", settings: HOOKS });
      expect(args.slice(0, 2)).toEqual(["resume", "01a1-thread"]);
      expect(args).toEqual(expect.arrayContaining(["--no-daemon", "-m", "m", "-s", "workspace-write", "-a", "never"]));
      expect(args.some((a) => a.startsWith("hooks.Stop="))).toBe(true);
    });

    it("fails without a thread id instead of starting a new thread", () => {
      expect(() => run({ resume: true })).toThrowError(CodexError);
      expect(() => run({ resume: true, nativeId: "" })).toThrowError(expect.objectContaining({ code: "noThread" }));
    });

    it("ignores the thread id of a new session", () => {
      expect(run({ resume: false, nativeId: "t1" }).args).not.toContain("resume");
    });
  });

  describe("subagent", () => {
    it("passes the agent's instructions, escaped, and its model", async () => {
      const repo = await tempDir("codex-launch-");
      await mkdir(path.join(repo, ".codex", "agents"), { recursive: true });
      await writeFile(path.join(repo, ".codex", "agents", "worker.toml"), 'model = "agent-model"\ndeveloper_instructions = """\nLine "one"\\n\ttwo \\\\ end\n"""\n');
      const { args } = run({ resume: false, repo, subagent: "worker" });
      expect(args).toEqual(expect.arrayContaining(["-m", "agent-model"]));
      const arg = args.find((a) => a.startsWith("developer_instructions="))!;
      expect(arg).not.toContain("\n"); // one argv element, one line
      expect(parseToml(`v = ${arg.slice("developer_instructions=".length)}`).v).toBe(
        parseToml(await readFile(path.join(repo, ".codex", "agents", "worker.toml"), "utf8")).developer_instructions,
      );
    });

    it("refuses a missing agent", () => {
      expect(() => run({ resume: false, subagent: "nope", repo: "/nonexistent" })).toThrowError(expect.objectContaining({ code: "subagentUnsupported" }));
    });
  });

  it("returns the app-server command for the probe, whatever the settings", () => {
    process.env.TASKPILOT_CODEX = "/opt/fake-codex";
    expect(codexLauncher("preflight", { resume: false, permissionMode: "plan", subagent: "nope", settings: HOOKS })).toMatchObject({
      file: "/opt/fake-codex",
      args: ["app-server", "--listen", "stdio://"],
    });
  });
});
