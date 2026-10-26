/** Providers a session can run; mirrors server/src/core/providers.ts. */
export const PROVIDER_IDS = ["claude", "copilot", "codex"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Product names, shown as they are in every language. */
export const PROVIDER_LABELS: Record<ProviderId, string> = { claude: "Claude", copilot: "Copilot", codex: "Codex" };
