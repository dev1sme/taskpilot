import { DEFAULT_AGENT, type Agent } from "../../../core/agents.js";
import { claudeBackend } from "./claude.js";
import { copilotBackend } from "./copilot.js";
import type { AgentBackend } from "./types.js";

export type { AgentBackend, HookState } from "./types.js";

/** One backend per agent; a new entry in AGENTS fails to compile until it is added here. */
export const BACKENDS: Record<Agent, AgentBackend> = {
  claude: claudeBackend,
  copilot: copilotBackend,
};

export function backendOf(agent: Agent | undefined): AgentBackend {
  return BACKENDS[agent ?? DEFAULT_AGENT];
}
