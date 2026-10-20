import type { FastifyInstance } from "fastify";
import { t } from "../../../core/i18n.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { settingsTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { applyPermissions, maskSettingsText, readPermissions, validatePermissions } from "./permissions.js";
import { readSettings } from "./read.js";

/** Settings files and their permissions. */
export function registerSettingsRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get("/api/config/settings", async () => readSettings(requireRepo()));

  app.get<{ Params: { scope: string } }>("/api/config/settings/:scope/permissions", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), ...readPermissions(current) };
  });

  app.post<{ Params: { scope: string } }>("/api/config/settings/:scope/permissions/preview", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    const next = applyPermissions(current, validatePermissions(req.body));
    return {
      diff: diffText(target.display, maskSettingsText(current === null ? null : applyPermissions(current, readPermissions(current))), maskSettingsText(next)),
      changed: next !== current,
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
    };
  });

  app.put<{ Params: { scope: string } }>("/api/config/settings/:scope/permissions", async (req) => {
    const repo = requireRepo();
    const target = settingsTarget(repo, scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return writeWithBackup({
      repo,
      target,
      next: applyPermissions(current, validatePermissions(req.body)),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.permissions"),
      backups,
    });
  });
}
