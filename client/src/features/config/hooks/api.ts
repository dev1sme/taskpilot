import { call } from "../../../shared/api/http";
import type { HookEntry, HookInput, HooksFile } from "./types";
import type { Scope, Preview, SaveResult } from "../shared/types";

export const hooksApi = {
  hooks: () => call<HookEntry[]>("GET", "/api/config/hooks"),
  hooksFile: (scope: Scope) => call<HooksFile>("GET", `/api/config/settings/${scope}/hooks`),
  hooksPreview: (scope: Scope, hooks: HookInput[], baseHash: string) => call<Preview>("POST", `/api/config/settings/${scope}/hooks/preview`, { hooks, baseHash }),
  hooksSave: (scope: Scope, hooks: HookInput[], baseHash: string) => call<SaveResult>("PUT", `/api/config/settings/${scope}/hooks`, { hooks, baseHash }),
};
