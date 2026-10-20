import { call } from "../../../shared/api/http";
import type { LibraryKind, LibraryItem } from "./types";
import type { Scope, RawFile, Preview, SaveResult } from "../shared/types";

export const libraryApi = {
  library: (kind: LibraryKind) => call<LibraryItem[]>("GET", `/api/config/${kind}`),
  libraryRaw: (kind: LibraryKind, scope: Scope, rel: string) =>
    call<RawFile>("GET", `/api/config/library/${kind}/${scope}/raw?rel=${encodeURIComponent(rel)}`),
  libraryPreview: (kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<Preview>("POST", `/api/config/library/${kind}/${scope}/preview`, { rel, content, baseHash }),
  librarySave: (kind: LibraryKind, scope: Scope, rel: string, content: string, baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/library/${kind}/${scope}`, { rel, content, baseHash }),
  libraryDelete: (kind: LibraryKind, scope: Scope, rel: string, baseHash: string) =>
    call<SaveResult>("DELETE", `/api/config/library/${kind}/${scope}?rel=${encodeURIComponent(rel)}&baseHash=${baseHash}`),
};
