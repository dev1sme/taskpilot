import type { Scope } from "../shared/types";

export interface HookEntry {
  scope: Scope;
  file: string;
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeout?: number;
}

export interface HookInput {
  event: string;
  matcher: string;
  command: string;
  timeout?: number;
  /** Other handler fields (if, args, async…), kept as they are on save. */
  extra?: Record<string, unknown>;
}

export interface HooksFile {
  path: string;
  exists: boolean;
  hash: string;
  hooks: HookInput[];
  /** The file's "hooks" value as written (every hook type); null when absent. */
  raw: unknown;
}

export interface CopilotHookInput {
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

export interface CopilotHookFile {
  scope: "project" | "user";
  name: string;
  path: string;
  hooks: CopilotHookInput[];
  error?: string;
}

export interface CopilotHookDetail {
  path: string;
  exists: boolean;
  hash: string;
  hooks: CopilotHookInput[];
}
