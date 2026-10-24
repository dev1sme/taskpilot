import { call } from "../../../shared/api/http";
import type { ConfigCli } from "../../../shared/router";
import type { AgentTemplate, LibraryKind, LibraryItem, TemplateInstallResult } from "./types";
import type { Scope, RawFile, Preview, SaveResult } from "../shared/types";

export const libraryApi = {
  library: (cli: ConfigCli, kind: LibraryKind) => call<LibraryItem[]>("GET", `/api/config/${kind}?cli=${cli}`),
  libraryRaw: (cli: ConfigCli, kind: LibraryKind, scope: Scope, rel: string) => call<RawFile>("GET", `/api/config/library/${kind}/${scope}/raw?cli=${cli}&rel=${encodeURIComponent(rel)}`),
  libraryPreview: (cli: ConfigCli, kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<Preview>("POST", `/api/config/library/${kind}/${scope}/preview?cli=${cli}`, { rel, content, baseHash }),
  librarySave: (cli: ConfigCli, kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/library/${kind}/${scope}?cli=${cli}`, { rel, content, baseHash }),
  libraryDelete: (cli: ConfigCli, kind: LibraryKind, scope: Scope, rel: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/library/${kind}/${scope}?cli=${cli}&rel=${encodeURIComponent(rel)}&baseHash=${encodeURIComponent(baseHash)}`),
  agentTemplates: (cli: ConfigCli) => call<AgentTemplate[]>("GET", `/api/config/agents/templates?cli=${cli}`),
  agentTemplatesPreview: (cli: ConfigCli, names: string[]) => call<{ files: AgentTemplate[]; diff: string }>("POST", "/api/config/agents/templates/preview", { cli, names }),
  agentTemplatesInstall: (cli: ConfigCli, names: string[], overwrite: string[], hashes: Record<string, string>) =>
    call<TemplateInstallResult>("POST", "/api/config/agents/templates/install", { cli, names, overwrite, hashes }),
};
