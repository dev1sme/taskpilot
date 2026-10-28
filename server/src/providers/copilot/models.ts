import { copilotAcpSession } from "./acp.js";

export interface CopilotModel {
  /** Name to pass to `--model`. */
  model: string;
  displayName?: string;
  /** Premium-request multiplier as copilot reports it, e.g. "1x". */
  usage?: string;
  isDefault: boolean;
}

const CACHE_MS = 10 * 60_000;

let cache: { at: number; models: CopilotModel[] } | null = null;
let inflight: Promise<CopilotModel[]> | null = null;

/** Models of the user's account via a short-lived `copilot --acp`; cached for 10 minutes. Failures are not cached. */
export function copilotModels(): Promise<CopilotModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.models);
  inflight ??= (async () => {
    const session = await copilotAcpSession();
    const models = session.models
      // An entry with no enablement is taken as usable; "disabled" and "unconfigured" are not.
      .filter((m) => m.enablement === undefined || m.enablement === "enabled")
      .map((m) => ({ model: m.modelId, displayName: m.name, usage: m.usage, isDefault: m.modelId === session.currentModelId }));
    cache = { at: Date.now(), models };
    return models;
  })().finally(() => (inflight = null));
  return inflight;
}

export function resetCopilotModelsCache(): void {
  cache = null;
}
