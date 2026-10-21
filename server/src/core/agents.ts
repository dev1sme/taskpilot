/** Coding agents a session can run. Adding one here makes TypeScript ask for its session backend. */
export const AGENTS = ["claude", "copilot"] as const;
export type Agent = (typeof AGENTS)[number];

/** Sessions, workflows and state saved before agents existed all run Claude. */
export const DEFAULT_AGENT: Agent = "claude";

/** Name of each agent in documents and logs. */
export const AGENT_LABELS: Record<Agent, string> = { claude: "Claude", copilot: "Copilot" };

export function isAgent(value: unknown): value is Agent {
  return typeof value === "string" && (AGENTS as readonly string[]).includes(value);
}
