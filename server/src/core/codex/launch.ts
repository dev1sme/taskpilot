import { readCodexAgent } from "./agents.js";
import { CodexError } from "./errors.js";

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

/** The command that starts one app-server on stdio; TASKPILOT_CODEX replaces the binary (tests, E2E). */
export function codexCommand(): { file: string; args: string[] } {
  return { file: process.env.TASKPILOT_CODEX ?? "codex", args: ["app-server", "--listen", "stdio://"] };
}

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
