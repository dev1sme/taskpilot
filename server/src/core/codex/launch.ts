import type { Launcher } from "../launch.js";
import { readCodexAgent } from "./agents.js";
import { CodexError } from "./errors.js";
import { codexHookArgs, tomlValue } from "./hooks.js";

/** `thread/start` / `thread/resume` fields TaskPilot sets. Absent fields keep the user's Codex config. */
export interface CodexThreadParams {
  cwd: string;
  model?: string;
  developerInstructions?: string;
  sandbox?: "workspace-write";
  approvalPolicy?: "on-request" | "never";
  approvalsReviewer?: CodexApprovalsReviewer;
  config?: { sandbox_workspace_write: { network_access: boolean } };
}

export type CodexApprovalsReviewer = "user" | "auto_review";
const REVIEWERS: readonly string[] = ["user", "auto_review"];

export interface CodexThreadOptions {
  cwd: string;
  permissionMode?: string;
  /** Absent = the user's default model. */
  model?: string;
  /** Name of a custom agent in `<cwd>/.codex/agents`; its instructions (and model, unless `model` is set) apply to the thread. */
  subagent?: string;
  /** Who answers approval requests; absent = the user's Codex config. Only applied with acceptEdits/auto. */
  approvalsReviewer?: CodexApprovalsReviewer;
  /** Network inside the workspace sandbox; absent = the user's Codex config (off by default). Only applied with acceptEdits/auto. */
  networkAccess?: boolean;
}

/**
 * Codex settings for each workflow permission-mode (fixtures README, "Quyền"). `default` and no mode
 * leave the user's config alone. acceptEdits runs commands inside the workspace sandbox without asking
 * and asks only to leave it. `plan` is refused: Codex's plan mode is experimental and cannot write the
 * step's document, and `read-only` cannot either. Never `danger-full-access`.
 */
const PERMISSION: Record<string, Pick<CodexThreadParams, "sandbox" | "approvalPolicy">> = {
  default: {},
  acceptEdits: { sandbox: "workspace-write", approvalPolicy: "on-request" },
  auto: { sandbox: "workspace-write", approvalPolicy: "never" },
};

/** The command that starts one app-server on stdio (probe, models, usage); TASKPILOT_CODEX replaces the binary (tests, E2E). */
export function codexAppServerCommand(): { file: string; args: string[] } {
  return { file: process.env.TASKPILOT_CODEX ?? "codex", args: ["app-server", "--listen", "stdio://"] };
}

/** Tells the hook commands that TaskPilot, not a Codex the user started by hand, runs this one. */
const HOOK_AGENT_ENV = { TASKPILOT_HOOK_AGENT: "codex" };

/**
 * Codex TUI (`codex`). Checked on codex 0.163.0 (docs/SPEC.md §7):
 * - `--no-daemon` is required with any `-c`, else the TUI warns about embedded mode;
 * - `check_for_update_on_startup=false` keeps the "Update available" dialog (and the Enter that would
 *   run the update) away;
 * - hooks come per run from `-c hooks.<Event>=…` (opts.settings), so no file of the user is touched;
 *   the user trusts them once in the TUI;
 * - there is no --session-id: a new thread gets its id from the first hook (`nativeIdOf`), and
 *   `codex resume <id>` needs it again together with every setting, since a resume keeps none.
 * The launcher with the id "preflight" is the probe's: it returns the app-server command.
 */
export const codexLauncher: Launcher = (sessionId, opts) => {
  if (sessionId === "preflight") return { ...codexAppServerCommand(), env: HOOK_AGENT_ENV };
  if (opts.resume && !opts.nativeId) throw new CodexError("noThread", "session has no Codex thread id to resume");
  const params = codexThreadOptions({
    cwd: opts.repo ?? process.cwd(),
    permissionMode: opts.permissionMode,
    model: opts.model,
    subagent: opts.subagent,
    approvalsReviewer: opts.codex?.approvalsReviewer,
    networkAccess: opts.codex?.networkAccess,
  });
  const config = (key: string, value: string | boolean): string[] => ["-c", `${key}=${tomlValue(value)}`];
  return {
    file: process.env.TASKPILOT_CODEX ?? "codex",
    args: [
      ...(opts.resume ? ["resume", opts.nativeId!] : []),
      "--no-daemon",
      ...config("check_for_update_on_startup", false),
      ...(params.model ? ["-m", params.model] : []),
      ...(params.sandbox ? ["-s", params.sandbox] : []),
      ...(params.approvalPolicy ? ["-a", params.approvalPolicy] : []),
      ...(params.approvalsReviewer ? config("approvals_reviewer", params.approvalsReviewer) : []),
      ...(params.config ? config("sandbox_workspace_write.network_access", params.config.sandbox_workspace_write.network_access) : []),
      ...(params.developerInstructions ? config("developer_instructions", params.developerInstructions) : []),
      ...codexHookArgs(opts.settings),
    ],
    env: HOOK_AGENT_ENV,
  };
};

/** Parameters for `thread/start` and, with `threadId`, `thread/resume`. Throws CodexError for what Codex cannot do. */
export function codexThreadOptions(opts: CodexThreadOptions): CodexThreadParams {
  const agent = opts.subagent ? readCodexAgent(opts.cwd, opts.subagent) : undefined;
  const mode = opts.permissionMode;
  const permission = mode === undefined ? {} : PERMISSION[mode];
  if (!permission) throw new CodexError("modeUnsupported", `permission-mode "${mode}" is not supported by Codex; use default, acceptEdits or auto`);
  if (opts.approvalsReviewer !== undefined && !REVIEWERS.includes(opts.approvalsReviewer)) {
    throw new CodexError("modeUnsupported", `approvalsReviewer "${opts.approvalsReviewer}" is not supported; use user or auto_review`);
  }
  if (opts.networkAccess !== undefined && typeof opts.networkAccess !== "boolean") {
    throw new CodexError("modeUnsupported", `networkAccess must be a boolean (got ${JSON.stringify(opts.networkAccess)})`);
  }
  // Without a sandbox of our own (default / no mode) the user's config decides; the options do not apply.
  const sandboxed = permission.sandbox !== undefined;
  return {
    cwd: opts.cwd,
    ...(opts.model || agent?.model ? { model: opts.model || agent?.model } : {}),
    ...(agent ? { developerInstructions: agent.developerInstructions } : {}),
    ...permission,
    ...(sandboxed && opts.approvalsReviewer ? { approvalsReviewer: opts.approvalsReviewer } : {}),
    ...(sandboxed && opts.networkAccess !== undefined ? { config: { sandbox_workspace_write: { network_access: opts.networkAccess } } } : {}),
  };
}

/** `thread/resume` parameters: the same settings again, since a resumed thread does not keep them. */
export function codexResumeOptions(opts: CodexThreadOptions & { threadId: string | undefined }): CodexThreadParams & { threadId: string; excludeTurns: true } {
  if (!opts.threadId) throw new CodexError("noThread", "session has no Codex thread id to resume");
  return { threadId: opts.threadId, ...codexThreadOptions(opts), excludeTurns: true };
}
