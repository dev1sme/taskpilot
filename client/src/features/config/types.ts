export type Scope = "project" | "local" | "user";

export interface MemoryFile {
  scope: Scope;
  path: string;
  exists: boolean;
  content: string;
  lines: number;
  bytes: number;
  mtime: number | null;
  headings: Array<{ level: number; text: string; line: number }>;
  imports: Array<{ ref: string; path: string; exists: boolean; bytes: number; depth: number; line: number }>;
  checks: Array<{ level: "ok" | "warn"; message: string; line?: number }>;
}

export interface MaskedValue {
  key: string;
  value: string;
  reference: boolean;
}

export interface SettingsFile {
  scope: Scope;
  path: string;
  exists: boolean;
  error?: string;
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode?: string;
  additionalDirectories: string[];
  env: MaskedValue[];
  otherKeys: string[];
}

export interface HookEntry {
  scope: Scope;
  file: string;
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeout?: number;
}

export type LibraryKind = "agents" | "commands" | "skills";

export interface LibraryItem {
  kind: LibraryKind;
  scope: "project" | "user";
  name: string;
  path: string;
  rel: string;
  description: string;
  fields: Array<{ key: string; value: string }>;
  body: string;
  mtime: number | null;
  error?: string;
  files?: string[];
}

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
  /** Why Claude Code skips this entry. */
  error?: string;
}

export interface McpConfig {
  sources: Array<{ scope: Scope; path: string; exists: boolean; error?: string }>;
  servers: McpServer[];
}

export interface RawFile {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
}

export interface Permissions {
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode: string | null;
}

export interface PermissionsFile extends Permissions {
  path: string;
  exists: boolean;
  hash: string;
}

export interface Preview {
  diff: string;
  changed: boolean;
  /** The file changed on disk since it was loaded. */
  stale: boolean;
}

export interface BackupEntry {
  id: string;
  at: number;
  path: string;
  display: string;
  reason: string;
  bytes: number;
  existed: boolean;
  restorable?: boolean;
}

export interface SaveResult {
  hash: string;
  backup: BackupEntry;
}

export interface CodegraphStatus {
  supported: boolean;
  indexed: boolean;
  detail: string | null;
  error: string | null;
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
