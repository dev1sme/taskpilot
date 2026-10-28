import { t } from "../../../core/i18n.js";
import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../../core/errors.js";

import { hookTarget } from "../shared/targets.js";
import { PLAIN_JSON } from "../adapters/file-names.js";
import type { HooksAdapter } from "../adapters/index.js";
import type { ProviderId } from "../../../core/providers.js";

export type FileHooks = Extract<HooksAdapter, { kind: "files" }>;
import { readCurrent } from "../shared/writer.js";
import type { ConfigScope } from "../shared/sections.js";
import { isObject } from "../../../core/values.js";

/** A Copilot command hook as the UI shows it; other hook types and fields are not shown. */
export interface CopilotHookEntry {
  event: string;
  matcher?: string;
  command?: string;
  bash?: string;
  powershell?: string;
  exec?: string;
  args?: string[];
  cwd?: string;
  timeoutSec?: number;
}

const COPILOT_EVENTS = new Set([
  "agentStop",
  "errorOccurred",
  "notification",
  "permissionRequest",
  "postToolUse",
  "postToolUseFailure",
  "preCompact",
  "preToolUse",
  "sessionEnd",
  "sessionStart",
  "subagentStart",
  "subagentStop",
  "userPromptSubmitted",
  "userPromptTransformed",
]);
const COPILOT_EVENT_ALIASES = new Set(["Stop", "UserPromptSubmit"]);

function isCopilotEvent(event: string): boolean {
  const canonical = event[0]?.toLowerCase() + event.slice(1);
  return COPILOT_EVENTS.has(canonical) || COPILOT_EVENT_ALIASES.has(event);
}

const EDITABLE_FIELDS = new Set(["type", "matcher", "command", "bash", "powershell", "exec", "args", "cwd", "timeoutSec"]);

function parse(text: string | null): Record<string, unknown> {
  if (text === null) return { version: 1, hooks: {} };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(409, t("configMessages.hooks_copilot_01"));
  }
  if (!isObject(data) || data.version !== 1 || !isObject(data.hooks) || Object.values(data.hooks).some((v) => !Array.isArray(v))) {
    throw new HttpError(409, t("configMessages.hooks_copilot_02"));
  }
  return data;
}

function editable(event: string, entry: unknown): entry is Record<string, unknown> {
  return (
    isCopilotEvent(event) &&
    isObject(entry) &&
    (entry.type === undefined || entry.type === "command") &&
    Object.keys(entry).every((key) => EDITABLE_FIELDS.has(key)) &&
    (typeof entry.exec === "string" || [entry.command, entry.bash, entry.powershell].some((v) => typeof v === "string"))
  );
}

/** Only simple command entries are exposed; env, HTTP headers and other private fields stay on disk. */
export function readCopilotHooks(text: string | null): CopilotHookEntry[] {
  const data = parse(text);
  const out: CopilotHookEntry[] = [];
  for (const [event, entries] of Object.entries(data.hooks as Record<string, unknown[]>)) {
    for (const entry of entries) {
      if (!editable(event, entry)) continue;
      const { type: _type, ...fields } = entry;
      out.push({ event, ...fields } as CopilotHookEntry);
    }
  }
  return out;
}

/** Refuse reads through hook-directory symlinks as well as file symlinks, up to the repo or the CLI's home. */
export async function readCopilotHookFile(repo: string, abs: string, hooks: FileHooks): Promise<string | null> {
  const projectRoot = path.resolve(repo);
  const userRoot = path.resolve(path.dirname(hooks.dir(repo, "user")));
  const root = abs.startsWith(userRoot + path.sep) ? userRoot : projectRoot;
  for (let current = path.resolve(abs); current !== root; current = path.dirname(current)) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new HttpError(409, t("configMessages.hooks_copilot_03"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (root === userRoot) {
    try {
      if ((await lstat(root)).isSymbolicLink()) throw new HttpError(409, t("configMessages.hooks_copilot_04"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return readCurrent(abs);
}

/** One hook file of a CLI that keeps hooks in files of their own, with its editable command hooks. */
export interface HookFile {
  scope: ConfigScope;
  name: string;
  path: string;
  hooks: CopilotHookEntry[];
  error?: string;
}

export async function listHookFiles(
  repo: string,
  cli: ProviderId,
  hooks: FileHooks,
): Promise<HookFile[]> {
  const out: HookFile[] = [];
  for (const scope of hooks.scopes) {
    const root = hooks.dir(repo, scope);
    let names: string[];
    try {
      names = await readdir(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names.sort()) {
      if (hooks.reserved.includes(name) || !PLAIN_JSON.test(name)) continue;
      const target = hookTarget(repo, scope, name, cli);
      if (!(await lstat(target.abs)).isFile()) continue;
      try {
        out.push({ scope, name, path: target.display, hooks: readCopilotHooks(await readCopilotHookFile(repo, target.abs, hooks)) });
      } catch {
        out.push({ scope, name, path: target.display, hooks: [], error: t("configMessages.hooks_copilot_05") });
      }
    }
  }
  return out;
}
