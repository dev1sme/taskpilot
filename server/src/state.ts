import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AppState {
  lastRepo?: string;
}

/** App-level state in ~/.taskpilot/state.json (override the directory with TASKPILOT_HOME). */
export class StateStore {
  readonly file: string;

  constructor(dir = process.env.TASKPILOT_HOME ?? path.join(os.homedir(), ".taskpilot")) {
    this.file = path.join(dir, "state.json");
  }

  async load(): Promise<AppState> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as AppState;
    } catch {
      return {};
    }
  }

  async save(state: AppState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.file);
  }
}
