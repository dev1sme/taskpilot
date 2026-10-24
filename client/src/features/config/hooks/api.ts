import { call } from "../../../shared/api/http";
import type { CopilotHookDetail, CopilotHookFile, CopilotHookInput, HookEntry, HookInput, HooksFile } from "./types";
import type { Scope, Preview, SaveResult } from "../shared/types";

export const hooksApi = {
  hooks: () => call<HookEntry[]>("GET", "/api/config/hooks"),
  hooksFile: (scope: Scope) => call<HooksFile>("GET", `/api/config/settings/${scope}/hooks`),
  hooksPreview: (scope: Scope, hooks: HookInput[], baseHash: string) => call<Preview>("POST", `/api/config/settings/${scope}/hooks/preview`, { hooks, baseHash }),
  hooksSave: (scope: Scope, hooks: HookInput[], baseHash: string) => call<SaveResult>("PUT", `/api/config/settings/${scope}/hooks`, { hooks, baseHash }),
  copilotFiles: () => call<CopilotHookFile[]>("GET", "/api/config/hooks?cli=copilot"),
  copilotDetail: (scope: "project" | "user", name: string) => call<CopilotHookDetail>("GET", `/api/config/hooks/${scope}/${encodeURIComponent(name)}?cli=copilot`),
  copilotPreview: (scope: "project" | "user", name: string, hooks: CopilotHookInput[], baseHash: string) =>
    call<Preview>("POST", `/api/config/hooks/${scope}/${encodeURIComponent(name)}/preview?cli=copilot`, { hooks, baseHash }),
  copilotSave: (scope: "project" | "user", name: string, hooks: CopilotHookInput[], baseHash: string) =>
    call<SaveResult>("PUT", `/api/config/hooks/${scope}/${encodeURIComponent(name)}?cli=copilot`, { hooks, baseHash }),
};
