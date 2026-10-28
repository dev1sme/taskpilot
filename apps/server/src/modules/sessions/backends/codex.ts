import path from "node:path";
import { readCodexAgent } from "../../../providers/codex/agents.js";
import { CodexError, RpcError } from "../../../providers/codex/errors.js";
import { codexLauncher } from "../../../providers/codex/cli-launcher.js";
import { rolloutTokens } from "../../../providers/codex/rollout.js";
import { fetchCodexModels } from "../../../providers/codex/models.js";
import { fetchCodexLoggedIn, initializeCodexAppServer, withCodexAppServer } from "../../../providers/codex/app-server.js";
import { codexHookSettings, type HookEvent } from "../hooks.js";
import type { SessionMetrics } from "../transports/types.js";
import { emptyCapability, probeError, problem } from "./probe.js";
import type { ProviderBackend, ProviderCapability, BackendProbeContext, HookState, PreflightProblem, SubagentCheck } from "./types.js";

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
export const codexBackend: ProviderBackend = {
  id: "codex",
  launchOptions: (meta, options) => ({ ...options, settings: codexHookSettings(), nativeId: meta.nativeId, codex: meta.codex }),
  launcher: codexLauncher,
  permissionModes: ["default", "acceptEdits", "auto"],
  supportsSubagents: true,
  // Codex answers `account/read` and `model/list` through the App Server, so both can block.
  requiresLogin: true,
  requiresModelInventory: true,
  warnsWhenNoHook: false,
  metricsSource: "codex-thread",
  checkSubagent: checkCodexSubagent,
  turnMetrics: codexTurnMetrics,
  probe: probeCodex,
  // Codex fires SessionStart only together with the first prompt, so the engine cannot wait for it.
  readyMarker: CODEX_READY_MARKER,
  nativeIdOf: (payload) => (typeof payload.session_id === "string" && payload.session_id ? payload.session_id : undefined),
  normalize: normalizeCodex,
};

function checkCodexSubagent(repo: string, name: string): SubagentCheck {
  try {
    readCodexAgent(repo, name);
    return "found";
  } catch {
    return "unsupported";
  }
}

/** Codex has no status line: its Stop hook carries the model and the rollout path, whose last `token_count` is the thread total. */
export async function codexTurnMetrics(event: HookEvent, payload: Record<string, unknown>): Promise<SessionMetrics | null> {
  if (event !== "Stop" || payload.interrupted === true) return null;
  const rollout = typeof payload.transcript_path === "string" && path.isAbsolute(payload.transcript_path) ? await rolloutTokens(payload.transcript_path) : {};
  return { source: "codex-thread", ...rollout, model: typeof payload.model === "string" ? payload.model : undefined };
}

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

async function probeCodex(context: BackendProbeContext): Promise<ProviderCapability> {
  const capability = emptyCapability(codexBackend);
  try {
    // A deadline covers handshake + account + every inventory page, not just each request.
    await withCodexAppServer({ env: context.extraEnv, cwd: context.repo, command: context.command, timeoutMs: context.timeoutMs }, async ({ rpc }, timedOut) => {
      const issueOf = (error: unknown, field: "cli" | "login" | "model") => (timedOut() ? problem("codex", "timeout", field) : codexProbeError(error, field));
      try {
        const init = await initializeCodexAppServer(rpc, { timeoutMs: context.timeoutMs });
        capability.cli = { status: "supported", source: "initialize", version: /\b\d+\.\d+\.\d+\b/.exec(init.userAgent ?? "")?.[0] };
        // model/list is deliberately independent: Codex answers it even when logged out.
        const [login, models] = await Promise.allSettled([fetchCodexLoggedIn(rpc), fetchCodexModels(rpc)]);
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
      }
    });
  } catch (error) {
    // Only the spawn can reject here: the callback handles its own failures.
    const issue = codexProbeError(error, "cli");
    capability.cli = { status: issue.code === "missing_cli" ? "unsupported" : "unknown", source: "initialize", error: issue };
  }
  return capability;
}
