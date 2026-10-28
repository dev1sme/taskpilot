import type { ProviderId } from "@server/api-types";

export type { ProviderId };

/** Product names, shown as they are in every language; the Record makes a new provider a type error here. */
export const PROVIDER_LABELS: Record<ProviderId, string> = { claude: "Claude", copilot: "Copilot", codex: "Codex" };

export const PROVIDER_IDS = Object.keys(PROVIDER_LABELS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(PROVIDER_LABELS, value);
}
