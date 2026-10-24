import { call } from "../../../shared/api/http";
import type { ConfigCli } from "../../../shared/router";
import type { MemoryFile } from "./types";
import type { Scope, RawFile, Preview, SaveResult } from "../shared/types";

export const memoryApi = {
  memory: (cli: ConfigCli) => call<MemoryFile[]>("GET", `/api/config/memory?cli=${cli}`),
  memoryRaw: (cli: ConfigCli, scope: Scope) => call<RawFile>("GET", `/api/config/memory/${scope}/raw?cli=${cli}`),
  memoryPreview: (cli: ConfigCli, scope: Scope, content: string, baseHash: string) => call<Preview>("POST", `/api/config/memory/${scope}/preview?cli=${cli}`, { content, baseHash }),
  memorySave: (cli: ConfigCli, scope: Scope, content: string, baseHash: string) => call<SaveResult>("PUT", `/api/config/memory/${scope}?cli=${cli}`, { content, baseHash }),
};
