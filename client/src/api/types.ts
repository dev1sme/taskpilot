export type Stage = "new" | "investigated" | "planned" | "implementing" | "summarized";

export type RunPhase = "starting" | "running" | "waiting" | "gate" | "interrupted" | "done" | "cancelled";

export interface TaskFile {
  path: string;
  size: number;
  mtime: number;
}

export interface TaskSummary {
  key: string;
  title: string;
  stage: Stage;
  specFiles: TaskFile[];
  outputFiles: TaskFile[];
  updatedAt: number;
  run: { phase: RunPhase; stepIndex: number; stepStartedAt: number } | null;
  waitingPermission: boolean;
  sessionsRunning: number;
}

export interface Info {
  claudeVersion: string | null;
}

/** Read-only summary of the repo's Claude Code configuration. */
export interface Inventory {
  claudeMd: { exists: boolean; lines: number; bytes: number; mtime: number | null; headings: string[] };
  claudeLocalMd: boolean;
  mcp: { exists: boolean; servers: Array<{ name: string; type: string }>; error?: string };
  claudeDir: { agents: number; commands: number; skills: number; hooks: number; allow: number; deny: number };
}

export interface RunState {
  taskKey: string;
  sessionId: string;
  stepIndex: number;
  phase: RunPhase;
  message: string;
  lastMessage?: string;
  stepStartedAt: number;
  startedAt: number;
  updatedAt: number;
}

export interface WorkflowStep {
  id: string;
  title: string;
  gate: "approve" | "none";
  doneFile: string | null;
}

export interface RunView {
  workflow: { source: string; steps: WorkflowStep[] };
  run: RunState | null;
}

export interface UsageWindow {
  usedPercentage: number;
  /** Epoch ms. */
  resetsAt: number | null;
}

/** Plan usage last reported by a session's status line; mirrors server/src/sessions/usage.ts. */
export interface UsageView {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  spend?: { usedPercentage: number };
  updatedAt: number;
}

/** Session key of the repo terminal (sessions without a task); mirrors server/src/repo/tasks.ts. */
export const REPO_SESSION_KEY = "@repo";

export interface SessionView {
  id: string;
  taskKey: string;
  title: string;
  createdAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  activity: "starting" | "idle" | "busy" | "permission" | null;
}

export interface AuthStatus {
  /** "password": log in with user and password. "token": open the URL the server printed. */
  mode: "password" | "token";
  authenticated: boolean;
}

export interface RepoInfo {
  path: string | null;
  tasksDir: string | null;
  tasksDirExists: boolean;
}

export type ToolCategory = "read" | "write" | "run" | "search" | "web" | "agent" | "plan" | "other";

export interface ActivityItem {
  id: string;
  sessionId: string;
  taskKey: string;
  at: number;
  kind: "session" | "prompt" | "tool" | "permission" | "stop";
  summary: string;
  detail?: string;
  tool?: string;
  category?: ToolCategory;
  status?: "running" | "done" | "error";
  durationMs?: number;
}

// ------------------------------------------------------------------ Claude config (read-only)

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

// ------------------------------------------------------------------ edits (phase C)

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
