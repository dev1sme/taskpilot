import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { isObject } from "../../../core/values.js";
import type { ProviderId } from "@taskpilot/shared";
import type { HooksAdapter } from "../adapters/index.js";
import { hookEntries } from "../settings/read.js";
import { hookTarget } from "../shared/targets.js";
import { readCurrent } from "../shared/writer.js";
import type { HookScopeFile } from "./types.js";

type ScopeHooks = Extract<HooksAdapter, { kind: "file" }>;

/** A hooks.json must be an object whose `hooks` maps each event to an array of matcher groups. */
export function checkHooksDocument(text: string): void {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) throw new HttpError(400, t("configMessages.hooks_file_01"));
  if (data.hooks === undefined) return;
  if (!isObject(data.hooks) || Object.values(data.hooks).some((groups) => !Array.isArray(groups) || groups.some((g) => !isObject(g) || (g.hooks !== undefined && !Array.isArray(g.hooks)))))
    throw new HttpError(400, t("configMessages.hooks_file_01"));
}

/** Every scope's hooks file, missing ones included, so the page can offer to create them. */
export async function listScopeHookFiles(repo: string, cli: ProviderId, hooks: ScopeHooks): Promise<HookScopeFile[]> {
  return Promise.all(
    hooks.scopes.map(async (scope) => {
      const target = hookTarget(repo, scope, undefined, cli);
      const text = await readCurrent(target.abs);
      const base: HookScopeFile = { scope, path: target.display, exists: text !== null, hooks: [] };
      if (text === null) return base;
      try {
        checkHooksDocument(text);
        return { ...base, hooks: hookEntries(JSON.parse(text), scope, target.display) };
      } catch {
        return { ...base, error: t("configMessages.hooks_file_02") };
      }
    }),
  );
}
