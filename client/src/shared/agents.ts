/** Coding agents a session can run; mirrors server/src/core/agents.ts. */
export const AGENTS = ["claude", "copilot", "codex"] as const;
export type Agent = (typeof AGENTS)[number];

export function isAgent(value: unknown): value is Agent {
  return typeof value === "string" && (AGENTS as readonly string[]).includes(value);
}

/** Product names, shown as they are in every language. */
export const AGENT_LABELS: Record<Agent, string> = { claude: "Claude", copilot: "Copilot", codex: "Codex" };
