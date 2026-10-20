import type { FastifyInstance } from "fastify";
import { t } from "../../../core/i18n.js";
import { maskSettingsText } from "../settings/permissions.js";
import { readHooks } from "../settings/read.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { settingsTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { applyHooks, readHookInputs, readHooksBlock, validateHooks } from "./edit.js";

/** Command hooks of each settings file. */
export function registerConfigHooksRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get("/api/config/hooks", async () => readHooks(requireRepo()));

  app.get<{ Params: { scope: string } }>("/api/config/settings/:scope/hooks", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), hooks: readHookInputs(current), raw: readHooksBlock(current) };
  });

  app.post<{ Params: { scope: string } }>("/api/config/settings/:scope/hooks/preview", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    const next = applyHooks(current, validateHooks(req.body));
    const normalized = current === null ? null : applyHooks(current, readHookInputs(current));
    return {
      diff: diffText(target.display, maskSettingsText(normalized), maskSettingsText(next)),
      changed: next !== normalized,
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
    };
  });

  app.put<{ Params: { scope: string } }>("/api/config/settings/:scope/hooks", async (req) => {
    const repo = requireRepo();
    const target = settingsTarget(repo, scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return writeWithBackup({
      repo,
      target,
      next: applyHooks(current, validateHooks(req.body)),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.hooks"),
      backups,
    });
  });
}
