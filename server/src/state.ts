import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SessionMeta {
  /** Also the Claude Code session id (`--session-id` / `--resume`). */
  id: string;
  repo: string;
  taskKey: string;
  title: string;
  createdAt: number;
}

export interface AppState {
  lastRepo?: string;
  sessions: SessionMeta[];
}

/**
 * App-level state in ~/.taskpilot/state.json (override the directory with TASKPILOT_HOME).
 * Cached in memory; updates are serialized so concurrent requests cannot lose writes.
 */
export class StateStore {
  readonly file: string;
  private cache: AppState | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir = process.env.TASKPILOT_HOME ?? path.join(os.homedir(), ".taskpilot")) {
    this.file = path.join(dir, "state.json");
  }

  async load(): Promise<AppState> {
    if (!this.cache) {
      let raw: Partial<AppState> = {};
      try {
        raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<AppState>;
      } catch {
        // Missing or corrupt file: start empty.
      }
      this.cache = { ...raw, sessions: raw.sessions ?? [] };
    }
    return this.cache;
  }

  update(change: (state: AppState) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const state = await this.load();
      change(state);
      await this.write(state);
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
