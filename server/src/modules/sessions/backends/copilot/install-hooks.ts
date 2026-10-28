import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOOK_EVENTS, copilotHookCommand } from "../../hooks.js";
import { copilotHome } from "../../../../providers/copilot/home.js";

let writing: Promise<unknown> = Promise.resolve();

/** The user-level hooks file TaskPilot owns (no one else writes taskpilot.json). */
function copilotHooksFile(): string {
  return path.join(copilotHome(), "hooks", "taskpilot.json");
}

/**
 * Installs TaskPilot's hooks as a user-level hooks file, hooks/taskpilot.json under COPILOT_HOME
 * (default ~/.copilot). Checked on copilot 1.0.101: user hooks survive the plugin reload that drops
 * repo hooks while the folder is untrusted. The per-session URL and token come from the child's
 * environment; the guard in the command makes the hooks do nothing in a Copilot TaskPilot did not
 * start. Sessions starting together write one at a time, and only when the content changes.
 */
export function ensureCopilotHooks(): Promise<void> {
  const next = writing.then(() => writeIfChanged(copilotHooksFile(), userHooksText()));
  writing = next.catch(() => undefined);
  return next;
}

async function writeIfChanged(file: string, text: string): Promise<void> {
  try {
    if ((await readFile(file, "utf8")) === text) return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.taskpilot-${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/** The hooks file in Copilot's flat schema ({type, bash, timeoutSec}) with TaskPilot's guard. */
function userHooksText(): string {
  const hooks: Record<string, unknown> = {};
  for (const event of HOOK_EVENTS) hooks[event] = [{ type: "command", bash: copilotHookCommand(event), timeoutSec: 10 }];
  return `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`;
}
