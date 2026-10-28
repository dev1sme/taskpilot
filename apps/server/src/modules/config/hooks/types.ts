import type { ConfigScope } from "../shared/sections.js";

/** A Copilot command hook as the UI shows it; other hook types and fields are not shown. */
export interface CopilotHookEntry {
  event: string;
  matcher?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  exec?: string;
  args?: string[];
  cwd?: string;
  timeoutSec?: number;
}

/** One hook file of a CLI that keeps hooks in files of their own, with its editable command hooks. */
export interface HookFile {
  scope: ConfigScope;
  name: string;
  path: string;
  hooks: CopilotHookEntry[];
  error?: string;
}
