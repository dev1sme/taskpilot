import type { Scope, MaskedValue, Preview } from "../shared/types";

export interface McpServer {
  name: string;
  scope: Scope;
  type: string;
  command?: string;
  args: string[];
  url?: string;
  env: MaskedValue[];
  headers: MaskedValue[];
  missingEnv: string[];
  fromTaskPilot: string[];
  /** Why the selected CLI skips this entry. */
  error?: string;
  source?: string;
  editable?: boolean;
  effective?: boolean;
}

export interface McpConfig {
  sources: Array<{ scope: Scope; path: string; exists: boolean; error?: string }>;
  servers: McpServer[];
}

export interface ValueRow {
  key: string;
  /** null = keep the configured value. */
  value: string | null;
  secret?: boolean;
}

export type McpType = "stdio" | "http" | "sse" | "ws" | "streamable-http";

export interface McpEntryInput {
  name: string;
  originalName?: string;
  type: McpType;
  command?: string;
  args: string[];
  url?: string;
  env: ValueRow[];
  headers: ValueRow[];
}

export interface McpEntryForm {
  name: string;
  scope: Scope;
  type: McpType;
  command?: string;
  args: string[];
  url?: string;
  env: MaskedValue[];
  headers: MaskedValue[];
  hash: string;
}

export interface McpPreview extends Preview {
  secrets: string[];
}

export interface McpCheck {
  status: "connected" | "failed" | "pending" | "auth" | "unknown";
  label: string;
}
