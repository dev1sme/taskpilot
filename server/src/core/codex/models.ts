import { CodexError } from "./errors.js";
import type { CodexRpc } from "./app-server.js";

export interface CodexModel {
  id: string;
  /** Name to pass as `model`; equals `id` in every answer seen so far. */
  model: string;
  displayName?: string;
  isDefault: boolean;
}

/** model/list pages; a few fit in one answer, so a loop past this is a server bug. */
const MAX_PAGES = 20;

/** Reads `model/list` (visible models, all pages) over an open, initialized connection. */
export async function fetchCodexModels(rpc: CodexRpc): Promise<CodexModel[]> {
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
