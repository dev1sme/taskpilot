import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../core/errors.js";
import { t } from "../core/i18n.js";

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Environment variables TaskPilot adds to the claude sessions it starts, per repo.
 * Claude Code expands `${VAR}` in MCP config from its process environment only (not from
 * settings "env"; see docs/SPEC.md §7), so this is where MCP secrets for shared .mcp.json
 * servers live. Stored in <state dir>/env.json with mode 0600; values never go to the browser.
 */
export class EnvStore {
  private cache: Record<string, Record<string, string>> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "env.json");
  }

  async forRepo(repo: string): Promise<Record<string, string>> {
    return { ...((await this.load())[repo] ?? {}) };
  }

  set(repo: string, key: string, value: string): Promise<void> {
    if (!KEY.test(key)) throw new HttpError(400, t("errors.invalidEnvName", { key }));
    if (/[\r\n\0]/.test(value)) throw new HttpError(400, t("errors.envNewline"));
    return this.update((all) => {
      all[repo] = { ...(all[repo] ?? {}), [key]: value };
    });
  }

  remove(repo: string, key: string): Promise<void> {
    return this.update((all) => {
      if (!all[repo]) return;
      delete all[repo][key];
      if (Object.keys(all[repo]).length === 0) delete all[repo];
    });
  }

  private async load(): Promise<Record<string, Record<string, string>>> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(await readFile(this.file, "utf8")) as Record<string, Record<string, string>>;
      } catch {
        this.cache = {};
      }
    }
    return this.cache;
  }

  private update(change: (all: Record<string, Record<string, string>>) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const all = await this.load();
      change(all);
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, this.file);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
