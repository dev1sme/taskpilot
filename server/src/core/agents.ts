/** Coding agents a session can run. Adding one here makes TypeScript ask for its session backend. */
export const AGENTS = ["claude", "copilot"] as const;
export type Agent = (typeof AGENTS)[number];

/** Sessions, workflows and state saved before agents existed all run Claude. */
export const DEFAULT_AGENT: Agent = "claude";

export function isAgent(value: unknown): value is Agent {
  return typeof value === "string" && (AGENTS as readonly string[]).includes(value);
}
