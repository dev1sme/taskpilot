import { CodexError, RpcError } from "../../../core/codex/errors.js";
import { codexLauncher } from "../../../core/codex/launch.js";
import { listCodexModels } from "../../../core/codex/models.js";
import { codexLoggedIn, initializeCodex, spawnCodex } from "../../../core/codex/rpc.js";
import { codexHookSettings, type HookEvent } from "../hooks.js";
import { emptyCapability, probeError, problem } from "./probe.js";
import type { AgentBackend, AgentCapability, BackendProbeContext, HookState, PreflightProblem } from "./types.js";

/** Maps the app-server errors to a preflight problem; everything else falls back to the generic errno mapping. */
function codexProbeError(error: unknown, field: PreflightProblem["field"]): PreflightProblem {
  if (error instanceof CodexError) {
    const code = error.code === "missing" ? "missing_cli" : error.code === "timeout" ? "timeout" : error.code === "protocol" ? "protocol" : "probe_failed";
    return problem("codex", code, field);
  }
  if (error instanceof RpcError && error.rpcCode === -32601) return problem("codex", "protocol", field);
  return probeError("codex", error, field);
}

/**
 * Footer of Codex's input box (`<model> <effort> · <cwd>`), shown only after the folder trust, hook
 * review, update and working-directory dialogs. A regex because model and cwd vary; after ANSI is
 * removed the first paint can read `default·~/repo`. Checked on codex 0.163.0 (docs/SPEC.md §7).
 */
export const CODEX_READY_MARKER = /·\s*[~/]/;

/**
 * Codex TUI. Its hooks use Claude's event names with Claude-style payloads, so `normalize` fixes only
 * what differs: tool names, the missing `PostToolUseFailure`, and Esc firing `Interrupt` not `Stop`.
 */
export const codexBackend: AgentBackend = {
  id: "codex",
  launcher: codexLauncher,
  launchSettings: codexHookSettings,
  permissionModes: ["default", "acceptEdits", "auto"],
  supportsSubagents: true,
  probe: probeCodex,
  // Codex fires SessionStart only together with the first prompt, so the engine cannot wait for it.
  readyMarker: CODEX_READY_MARKER,
  nativeIdOf: (payload) => (typeof payload.session_id === "string" && payload.session_id ? payload.session_id : undefined),
  normalize: normalizeCodex,
};

/** Path of the first file an `apply_patch` patch adds, updates or deletes. */
function patchedFile(patch: unknown): string | undefined {
  return typeof patch === "string" ? /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch)?.[1]?.trim() : undefined;
}

export async function normalizeCodex(event: HookEvent, payload: Record<string, unknown>, _state: HookState): Promise<Record<string, unknown> | null> {
  const out = { ...payload };
  // Codex edits files with apply_patch; its input is the patch text in `command`.
  if (out.tool_name === "apply_patch") {
    out.tool_name = "Edit";
    const input = out.tool_input as { command?: unknown; file_path?: unknown } | undefined;
    const file = patchedFile(input?.command);
    if (input && typeof input === "object" && file && input.file_path === undefined) out.tool_input = { ...input, file_path: file };
  }
  switch (event) {
    case "SessionStart":
      // Arrives with the first prompt, after the session already reported itself ready.
      return null;
    case "Stop":
      // `Interrupt` is posted as Stop (codexHookSettings): the turn ended without an answer.
      return out.hook_event_name === "Interrupt" ? { ...out, interrupted: true } : out;
    default:
      return out;
  }
}

async function probeCodex(context: BackendProbeContext): Promise<AgentCapability> {
  const capability = emptyCapability(codexBackend);
  let proc: Awaited<ReturnType<typeof spawnCodex>>;
  try {
    proc = await spawnCodex(context.extraEnv, context.repo, context.command);
  } catch (error) {
    const issue = codexProbeError(error, "cli");
    capability.cli = { status: issue.code === "missing_cli" ? "unsupported" : "unknown", source: "initialize", error: issue };
    return capability;
  }
  // A deadline covers handshake + account + every inventory page, not just each request.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.rpc.close();
    proc.child.kill("SIGKILL");
  }, context.timeoutMs);
  const issueOf = (error: unknown, field: "cli" | "login" | "model") => (timedOut ? problem("codex", "timeout", field) : codexProbeError(error, field));
  try {
    const init = await initializeCodex(proc.rpc, { timeoutMs: context.timeoutMs });
    capability.cli = { status: "supported", source: "initialize", version: /\b\d+\.\d+\.\d+\b/.exec(init.userAgent ?? "")?.[0] };
    // model/list is deliberately independent: Codex answers it even when logged out.
    const [login, models] = await Promise.allSettled([codexLoggedIn(proc.rpc), listCodexModels(proc.rpc)]);
    capability.login =
      login.status === "fulfilled"
        ? { status: login.value ? "supported" : "unsupported", source: "account/read", ...(!login.value ? { error: problem("codex", "not_logged_in", "login") } : {}) }
        : { status: "unknown", source: "account/read", error: issueOf(login.reason, "login") };
    capability.models =
      models.status === "fulfilled"
        ? { status: "supported", source: "model/list", items: models.value }
        : { status: "unknown", source: "model/list", items: [], error: issueOf(models.reason, "model") };
  } catch (error) {
    capability.cli = { status: "unknown", source: "initialize", error: issueOf(error, "cli") };
  } finally {
    clearTimeout(timer);
    proc.rpc.close();
    // Probe has no work to save and must not leave an app-server behind.
    proc.child.kill("SIGKILL");
  }
  return capability;
}
