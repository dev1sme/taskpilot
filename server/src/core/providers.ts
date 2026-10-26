/** Coding agents a session can run. Adding one here makes TypeScript ask for its session backend. */
export const PROVIDER_IDS = ["claude", "copilot", "codex"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Sessions, workflows and state saved before agents existed all run Claude. */
export const DEFAULT_PROVIDER: ProviderId = "claude";

/** Name of each agent in documents and logs. */
export const PROVIDER_LABELS: Record<ProviderId, string> = { claude: "Claude", copilot: "Copilot", codex: "Codex" };

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}
