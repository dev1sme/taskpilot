import { call } from "../../../shared/api/http";
import type { AgentTemplate, LibraryKind, LibraryItem, TemplateInstallResult } from "./types";
import type { Scope, RawFile, Preview, SaveResult } from "../shared/types";

export const libraryApi = {
  library: (kind: LibraryKind) => call<LibraryItem[]>("GET", `/api/config/${kind}`),
  libraryRaw: (kind: LibraryKind, scope: Scope, rel: string) => call<RawFile>("GET", `/api/config/library/${kind}/${scope}/raw?rel=${encodeURIComponent(rel)}`),
  libraryPreview: (kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<Preview>("POST", `/api/config/library/${kind}/${scope}/preview`, { rel, content, baseHash }),
  librarySave: (kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/library/${kind}/${scope}`, { rel, content, baseHash }),
  libraryDelete: (kind: LibraryKind, scope: Scope, rel: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/library/${kind}/${scope}?rel=${encodeURIComponent(rel)}&baseHash=${baseHash}`),
  agentTemplates: () => call<AgentTemplate[]>("GET", "/api/config/agents/templates"),
  agentTemplatesPreview: (names: string[]) => call<{ files: AgentTemplate[]; diff: string }>("POST", "/api/config/agents/templates/preview", { names }),
  agentTemplatesInstall: (names: string[], overwrite: string[], hashes: Record<string, string>) =>
    call<TemplateInstallResult>("POST", "/api/config/agents/templates/install", { names, overwrite, hashes }),
};
