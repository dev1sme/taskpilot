import { CodexError, RpcError } from "../../../core/codex/errors.js";
import { codexCommand } from "../../../core/codex/launch.js";
import { listCodexModels } from "../../../core/codex/models.js";
import { codexLoggedIn, initializeCodex, spawnCodex } from "../../../core/codex/rpc.js";
import { emptyCapability, probeError, problem } from "./probe.js";
import type { AgentBackend, AgentCapability, BackendProbeContext, PreflightProblem } from "./types.js";

/** Maps the app-server errors to a preflight problem; everything else falls back to the generic errno mapping. */
function codexProbeError(error: unknown, field: PreflightProblem["field"]): PreflightProblem {
  if (error instanceof CodexError) {
    const code = error.code === "missing" ? "missing_cli" : error.code === "timeout" ? "timeout" : error.code === "protocol" ? "protocol" : "probe_failed";
    return problem("codex", code, field);
  }
  if (error instanceof RpcError && error.rpcCode === -32601) return problem("codex", "protocol", field);
  return probeError("codex", error, field);
}

export const codexBackend: AgentBackend = {
  id: "codex",
  transport: "rpc",
  launcher: () => codexCommand(),
  permissionModes: ["default", "acceptEdits", "auto"],
  supportsSubagents: true,
  probe: probeCodex,
};

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
