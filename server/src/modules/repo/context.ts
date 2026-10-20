import { HttpError } from "../../core/errors.js";
import type { EventHub } from "../../core/events.js";
import type { StateStore } from "../../core/state.js";
import { resolveRepo, type TasksWatcher } from "../tasks/index.js";

/** The repo the UI works on: one at a time, remembered in state, watched for task changes. */
export interface RepoContext {
  current(): string | null;
  set(input: string): Promise<string>;
  /** The current repo, or a 409 when none is selected. */
  require(): string;
}

export function createRepoContext(deps: { watcher: TasksWatcher; state: StateStore; hub: EventHub }): RepoContext {
  const { watcher, hub } = deps;
  let repo: string | null = null;

  async function setRepo(input: string): Promise<string> {
    const resolved = await resolveRepo(input);
    repo = resolved;
    await watcher.watch(resolved);
    await deps.state.update((s) => {
      s.lastRepo = resolved;
    });
    hub.publish("repo", { path: resolved });
    return resolved;
  }

  function requireRepo(): string {
    if (!repo) throw new HttpError(409, "No repo selected");
    return repo;
  }

  return { current: () => repo, set: setRepo, require: requireRepo };
}
