import { watch, type FSWatcher } from "chokidar";
import { existsSync } from "node:fs";
import { tasksRoot } from "./scan.js";

/** Watches <repo>/.claude/tasks and calls `onChange` (debounced) when any file under it changes. */
export class TasksWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onChange: () => void) {}

  async watch(repo: string): Promise<void> {
    await this.close();
    // If the tasks dir is created later, the user changes repo or reloads; not worth watching .claude/.
    const root = tasksRoot(repo);
    if (!existsSync(root)) return;
    this.watcher = watch(root, { ignoreInitial: true, depth: 4 });
    this.watcher.on("all", () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(this.onChange, 200);
    });
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }
}
