import { copilotAcpSession, CopilotError } from "./acp.js";

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

/** Why a model cannot be used: not offered to the account, or the list could not be read. */
export type CopilotModelProblem = { kind: "unknown"; model: string; available: string[]; message: string } | { kind: "unavailable"; model: string; message: string; error: Error };

/** null when the account offers `model`. A list that cannot be read is "unavailable", not "unknown". */
export async function copilotModelProblem(model: string): Promise<CopilotModelProblem | null> {
  let models: CopilotModel[];
  try {
    models = await copilotModels();
  } catch (err) {
    const error = err instanceof Error ? err : new CopilotError("protocol", String(err));
    return { kind: "unavailable", model, message: `could not read the Copilot model list: ${error.message}`, error };
  }
  if (models.some((m) => m.model === model)) return null;
  const available = models.map((m) => m.model);
  return { kind: "unknown", model, available, message: `Copilot does not offer model "${model}"; available: ${available.join(", ") || "none"}` };
}
