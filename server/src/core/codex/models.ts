import { CodexError } from "./errors.js";
import { startCodex, type CodexRpc } from "./rpc.js";

export interface CodexModel {
  id: string;
  /** Name to pass as `model`; equals `id` in every answer seen so far. */
  model: string;
  displayName?: string;
  isDefault: boolean;
}

const CACHE_MS = 10 * 60_000;
/** model/list pages; a few fit in one answer, so a loop past this is a server bug. */
const MAX_PAGES = 20;

let cache: { at: number; models: CodexModel[] } | null = null;
let inflight: Promise<CodexModel[]> | null = null;

/** Reads `model/list` (visible models, all pages) over an open, initialized connection. */
export async function listCodexModels(rpc: CodexRpc): Promise<CodexModel[]> {
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: { data?: unknown; nextCursor?: unknown } | null = await rpc.request("model/list", { includeHidden: false, ...(cursor ? { cursor } : {}) });
    if (typeof result !== "object" || result === null || !Array.isArray(result.data)) throw new CodexError("protocol", "model/list returned no data array");
    for (const raw of result.data as Record<string, unknown>[]) {
      const model = typeof raw?.model === "string" ? raw.model : typeof raw?.id === "string" ? raw.id : null;
      if (!model) throw new CodexError("protocol", "model/list entry has neither model nor id");
      models.push({
        id: typeof raw.id === "string" ? raw.id : model,
        model,
        displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
        isDefault: raw.isDefault === true,
      });
    }
    cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    if (!cursor) return models;
  }
  throw new CodexError("protocol", "model/list did not end");
}

/** Models of the user's account via a short-lived app-server; cached for 10 minutes. Failures are not cached. */
export function codexModels(): Promise<CodexModel[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.models);
  inflight ??= (async () => {
    const proc = await startCodex();
    try {
      const models = await listCodexModels(proc.rpc);
      cache = { at: Date.now(), models };
      return models;
    } finally {
      proc.kill();
    }
  })().finally(() => (inflight = null));
  return inflight;
}

export function resetCodexModelsCache(): void {
  cache = null;
}

/** Why a model cannot be used: not offered to the account, or the list could not be read. */
export type CodexModelProblem = { kind: "unknown"; model: string; available: string[]; message: string } | { kind: "unavailable"; model: string; message: string; error: CodexError | Error };

/**
 * null when the account offers `model`. A list that cannot be read is "unavailable", not "unknown":
 * callers report it apart and do not block the other agents on it.
 */
export async function codexModelProblem(model: string): Promise<CodexModelProblem | null> {
  let models: CodexModel[];
  try {
    models = await codexModels();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { kind: "unavailable", model, message: `could not read the Codex model list: ${error.message}`, error };
  }
  if (models.some((m) => m.model === model || m.id === model)) return null;
  const available = models.map((m) => m.model);
  return { kind: "unknown", model, available, message: `Codex does not offer model "${model}"; available: ${available.join(", ") || "none"}` };
}
