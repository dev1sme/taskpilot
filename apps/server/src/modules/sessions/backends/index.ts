import { DEFAULT_PROVIDER, type ProviderId } from "@taskpilot/shared";
import { claudeBackend } from "./claude.js";
import { copilotBackend } from "./copilot/index.js";
import { codexBackend } from "./codex.js";
import type { ProviderBackend, ProviderTraits } from "./types.js";

export type { AccountUsageReport, ProviderBackend, HookState, ProviderPromptInventory, ProviderTraits, SubagentCheck } from "./types.js";

/** One backend per agent; a new entry in PROVIDER_IDS fails to compile until it is added here. */
export const BACKENDS: Record<ProviderId, ProviderBackend> = {
  claude: claudeBackend,
  copilot: copilotBackend,
  codex: codexBackend,
};

export function backendOf(agent: ProviderId | undefined): ProviderBackend {
  return BACKENDS[agent ?? DEFAULT_PROVIDER];
}

/** The provider's no-I/O facts, for callers (the workflow) that must not branch on its name. */
export function providerTraits(agent: ProviderId | undefined): ProviderTraits {
  return backendOf(agent);
}
