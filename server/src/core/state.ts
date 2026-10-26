import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProviderId } from "./providers.js";
import type { CodexUsage } from "./codex/usage.js";
import type { CopilotQuota } from "./copilot/quota.js";
import type { ClaudeUsage } from "../modules/usage/index.js";
import type { RunState } from "../modules/workflow/index.js";

export interface SessionMeta {
  /** TaskPilot's own id; also the agent's session id (`--session-id` / `--resume`) when nativeId is absent. */
  id: string;
  /** The agent's own id of the conversation when the agent picks it (Codex thread id); absent = id. */
  nativeId?: string;
  /** The coding agent the session runs; absent = claude (sessions saved before agents existed). */
  agent?: ProviderId;
  repo: string;
  taskKey: string;
  title: string;
  createdAt: number;
  /** Passed as --permission-mode on spawn and resume; absent = the user's own default. */
  permissionMode?: string;
  /** The model requested: passed as --model on spawn and resume; absent = the subagent's or the user's default. */
  model?: string;
  /** The model the agent reported itself (Codex hooks). Observed only, never passed to the CLI, so a default session stays default on resume. */
  actualModel?: string;
  /** Passed as --agent on spawn and resume; absent = the agent's own main session. */
  subagent?: string;
  /** Codex only: approval reviewer and sandbox network, from `codex:` in workflow.yml; absent = Codex's own configuration. */
  codex?: { approvalsReviewer?: "user" | "auto_review"; networkAccess?: boolean };
  /** A transfer locks both sessions until commit or an explicit recovery action. */
  reservation?: { operationId: string; role: "source" | "target"; at: number };
  /** Retired sessions stay visible in history but must not accept input or resume. */
  retired?: { operationId: string; replacedBy: string; at: number };
  /** Identifies the transport attempt owning callbacks and any surviving process. */
  generation?: number;
  /** A completed transport/group barrier, never inferred from a closed RPC stream. */
  exitedGeneration?: number;
  processOwner?: {
    pid: number;
    startedAt: number;
    generation: number;
    /** Isolated POSIX group containing the CLI and its tool children. */
    groupId?: number;
    /** Linux boot id + /proc start ticks; never infer ownership from PID alone. */
    identity?: string;
  };
}

export interface AppState {
  lastRepo?: string;
  sessions: SessionMeta[];
  /** Latest workflow run per (repo, taskKey). */
  runs: RunState[];
  /** Claude plan usage last reported by a session's status line. */
  usage?: ClaudeUsage;
  /** Account quota of the other agents (Copilot quota, Codex rate limits). */
  agentUsage?: { copilot?: CopilotQuota; codex?: CodexUsage };
}

/**
 * App-level state in ~/.taskpilot/state.json (override the directory with TASKPILOT_HOME).
 * Cached in memory; updates are serialized so concurrent requests cannot lose writes.
 */
export class StateStore {
  readonly dir: string;
  readonly file: string;
  private cache: AppState | null = null;
  private loading: Promise<AppState> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir = process.env.TASKPILOT_HOME ?? path.join(os.homedir(), ".taskpilot")) {
    this.dir = dir;
    this.file = path.join(dir, "state.json");
  }

  load(): Promise<AppState> {
    if (this.cache) return Promise.resolve(this.cache);
    return (this.loading ??= this.read());
  }

  private async read(): Promise<AppState> {
    if (!this.cache) {
      let raw: Partial<AppState> = {};
      try {
        raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<AppState>;
      } catch {
        // Missing or corrupt file: start empty.
      }
      // repoModes moved into each repo's .taskpilot/settings.yml: drop it so the next write cleans state.json.
      const { repoModes: _old, ...rest } = raw as Partial<AppState> & { repoModes?: unknown };
      this.cache = { ...rest, sessions: raw.sessions ?? [], runs: raw.runs ?? [] };
    }
    return this.cache;
  }

  update(change: (state: AppState) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const nextState = structuredClone(await this.load());
      change(nextState);
      await this.write(nextState);
      // Readers and queued callbacks only observe committed generations/reservations/journals.
      this.cache = nextState;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(state: AppState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.file);
  }
}
