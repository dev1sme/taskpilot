import { call } from "../../../shared/api/http";
import type { MemoryFile } from "./types";
import type { Scope, RawFile, Preview, SaveResult } from "../shared/types";

export const memoryApi = {
  memory: () => call<MemoryFile[]>("GET", "/api/config/memory"),
  memoryRaw: (scope: Scope) => call<RawFile>("GET", `/api/config/memory/${scope}/raw`),
  memoryPreview: (scope: Scope, content: string, baseHash: string) =>
    call<Preview>("POST", `/api/config/memory/${scope}/preview`, { content, baseHash }),
  memorySave: (scope: Scope, content: string, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/memory/${scope}`, { content, baseHash }),
};
