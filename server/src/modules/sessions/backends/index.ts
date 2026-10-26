import { DEFAULT_AGENT, type Agent } from "../../../core/agents.js";
import { claudeBackend } from "./claude.js";
import { copilotBackend } from "./copilot/index.js";
import { codexBackend } from "./codex.js";
import type { AgentBackend, ProviderTraits } from "./types.js";

export type { AgentBackend, HookState, ProviderPromptInventory, ProviderTraits, SubagentCheck } from "./types.js";

/** One backend per agent; a new entry in AGENTS fails to compile until it is added here. */
export const BACKENDS: Record<Agent, AgentBackend> = {
  claude: claudeBackend,
  copilot: copilotBackend,
  codex: codexBackend,
};

export function backendOf(agent: Agent | undefined): AgentBackend {
  return BACKENDS[agent ?? DEFAULT_AGENT];
}

/** The provider's no-I/O facts, for callers (the workflow) that must not branch on its name. */
export function providerTraits(agent: Agent | undefined): ProviderTraits {
  return backendOf(agent);
}
