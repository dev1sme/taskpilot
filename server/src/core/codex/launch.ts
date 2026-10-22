import { CodexError } from "./errors.js";

/** `thread/start` / `thread/resume` fields TaskPilot sets. Absent fields keep the user's Codex config. */
export interface CodexThreadParams {
  cwd: string;
  model?: string;
  sandbox?: "workspace-write";
  approvalPolicy?: "on-request" | "never";
}

export interface CodexThreadOptions {
  cwd: string;
  permissionMode?: string;
  /** Absent = the user's default model. */
  model?: string;
  /** A Codex session has no subagent. */
  subagent?: string;
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
  if (opts.subagent) throw new CodexError("subagentUnsupported", `Codex has no subagents (got "${opts.subagent}")`);
  const mode = opts.permissionMode;
  const permission = mode === undefined ? {} : PERMISSION[mode];
  if (!permission) throw new CodexError("modeUnsupported", `permission-mode "${mode}" is not supported by Codex; use default, acceptEdits or auto`);
  return { cwd: opts.cwd, ...(opts.model ? { model: opts.model } : {}), ...permission };
}

/** `thread/resume` parameters: the same settings again, since a resumed thread does not keep them. */
export function codexResumeOptions(opts: CodexThreadOptions & { threadId: string | undefined }): CodexThreadParams & { threadId: string; excludeTurns: true } {
  if (!opts.threadId) throw new CodexError("noThread", "session has no Codex thread id to resume");
  return { threadId: opts.threadId, ...codexThreadOptions(opts), excludeTurns: true };
}
