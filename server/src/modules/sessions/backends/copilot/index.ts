import { CopilotAgentError, listCopilotAgents, readCopilotAgent } from "../../../../core/copilot/agents.js";
import { copilotLauncher } from "../../../../core/copilot/launch.js";
import { CopilotError } from "../../../../core/copilot/acp.js";
import { copilotModels } from "../../../../core/copilot/models.js";
import type { AgentBackend, ProviderPromptInventory, SubagentCheck } from "../types.js";
import { probeError, probePty, problem } from "../probe.js";
import type { AgentCapability, BackendProbeContext } from "../types.js";
import { ensureCopilotHooks } from "./hooks-file.js";
import { copilotFinishedTurn, normalizeCopilot } from "./normalize.js";

export { COPILOT_SETTINGS, copilotHooksFile, ensureCopilotHooks, stripComments, userHooksText, withoutTaskPilotHooks } from "./hooks-file.js";
export { copilotFinishedTurn, normalizeCopilot } from "./normalize.js";
export { copilotTranscript, lastAssistantMessage } from "./transcript.js";

/**
 * Footer of copilot's input box; absent while the folder trust prompt is shown. Checked on copilot
 * 1.0.101: check it again after every Copilot upgrade (docs/SPEC.md §7).
 */
const READY_MARKER = "/ commands";
/**
 * GitHub Copilot CLI. Its hooks are declared with Claude's PascalCase event names, so Copilot
 * sends Claude-style snake_case payloads with Claude tool names; `normalize` fills the rest.
 */
export const copilotBackend: AgentBackend = {
  id: "copilot",
  permissionModes: ["default", "acceptEdits", "plan", "auto"],
  supportsSubagents: true,
  // Login and the model list are not verifiable here: the probe leaves them unknown and never blocks on them.
  requiresLogin: false,
  requiresModelInventory: false,
  reportsStatusLine: false,
  warnsWhenNoHook: true,
  checkSubagent: checkCopilotSubagent,
  promptInventory: copilotPromptInventory,
  probe: probeCopilot,
  launcher: copilotLauncher,
  prepare: ensureCopilotHooks,
  // Copilot fires SessionStart only together with the first prompt, so the engine cannot wait for it.
  readyMarker: READY_MARKER,
  // PermissionRequest fires for every tool call, also the ones Copilot then allows on its own.
  permissionGraceMs: 1500,
  normalize: normalizeCopilot,
  finishedTurn: copilotFinishedTurn,
};

/** Copilot also has built-in and plugin agents that are not files: only a malformed name is blocked, a missing file is unknown. */
function checkCopilotSubagent(repo: string, name: string): SubagentCheck {
  try {
    readCopilotAgent(repo, name);
    return "found";
  } catch (error) {
    return error instanceof CopilotAgentError && error.code === "invalidName" ? "unsupported" : "unknown";
  }
}

/** Custom agents of the repo and the account's model names; a model list that cannot be read is `null`, not an error. */
async function copilotPromptInventory(repo: string): Promise<ProviderPromptInventory> {
  const models = await copilotModels().then(
    (list) => list.map((m) => m.model),
    () => null,
  );
  return { agents: listCopilotAgents(repo), models };
}

/** `--version`, then the account's model list through `copilot --acp`. Login stays unknown; a list that cannot be read is unknown, never blocking. */
async function probeCopilot(context: BackendProbeContext): Promise<AgentCapability> {
  const capability = await probePty(copilotBackend, context);
  if (capability.cli.status !== "supported") return capability;
  let timer: NodeJS.Timeout | undefined;
  try {
    const models = await Promise.race([
      copilotModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), context.timeoutMs);
      }),
    ]);
    capability.models = { status: "supported", source: "model/list", items: models.map((m) => ({ id: m.model, model: m.model, displayName: m.displayName, isDefault: m.isDefault })) };
  } catch (error) {
    const code = error instanceof CopilotError ? error.code : (error as { code?: string }).code;
    const issue =
      code === "timeout"
        ? problem("copilot", "timeout", "model")
        : code === "protocol"
          ? problem("copilot", "protocol", "model")
          : code === "missing" || code === "ENOENT"
            ? problem("copilot", "missing_cli", "model")
            : probeError("copilot", error, "model");
    capability.models = { status: "unknown", source: "model/list", items: [], error: issue };
  } finally {
    clearTimeout(timer);
  }
  return capability;
}
