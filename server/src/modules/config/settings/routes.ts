import type { FastifyInstance } from "fastify";
import { t } from "../../../core/i18n.js";
import { configCli, markConfigAvailable } from "../shared/agent.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { settingsTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { applyPermissions, maskSettingsText, parsePermissions, validatePermissions } from "./permissions.js";
import { applyNativeFields, nativeDiffView, readNativeFields, validateNativeFields } from "./native.js";
import { readNativeSettings, readSettings } from "./read.js";
import { HttpError } from "../../../core/errors.js";

/** Settings files and their permissions. */
export function registerSettingsRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;
  markConfigAvailable("codex", "settings");
  markConfigAvailable("copilot", "settings");

  app.get<{ Querystring: { cli?: string } }>("/api/config/settings", async (req) => {
    const cli = configCli(req.query.cli);
    return cli === "claude" ? readSettings(requireRepo()) : readNativeSettings(requireRepo(), cli);
  });

  const native = (raw: string | undefined) => {
    const cli = configCli(raw);
    if (cli === "claude") throw new HttpError(400, t("configMessages.settings_routes_01"));
    return cli;
  };

  app.get<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/native", async (req) => {
    const cli = native(req.query.cli);
    const scope = scopeOf(req.params.scope);
    const target = settingsTarget(requireRepo(), scope, cli);
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), fields: readNativeFields(cli, scope, current) };
  });

  app.post<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/native/preview", async (req) => {
    const cli = native(req.query.cli);
    const scope = scopeOf(req.params.scope);
    const target = settingsTarget(requireRepo(), scope, cli);
    const current = await readCurrent(target.abs);
    const fields = validateNativeFields(cli, scope, req.body);
    const next = applyNativeFields(cli, current, fields);
    const before = readNativeFields(cli, scope, current);
    const after = readNativeFields(cli, scope, next);
    return {
      diff: diffText(target.display, nativeDiffView(before), nativeDiffView(after)),
      changed: nativeDiffView(before) !== nativeDiffView(after),
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
    };
  });

  app.put<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/native", async (req) => {
    const cli = native(req.query.cli);
    const scope = scopeOf(req.params.scope);
    const repo = requireRepo();
    const target = settingsTarget(repo, scope, cli);
    const current = await readCurrent(target.abs);
    const next = applyNativeFields(cli, current, validateNativeFields(cli, scope, req.body));
    return writeWithBackup({ repo, target, next, baseHash: stringField(req.body, "baseHash"), reason: t("backup.permissions"), backups });
  });

  app.get<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/permissions", async (req) => {
    if (configCli(req.query.cli) !== "claude") throw new HttpError(400, t("configMessages.settings_routes_02"));
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), ...parsePermissions(current) };
  });

  app.post<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/permissions/preview", async (req) => {
    if (configCli(req.query.cli) !== "claude") throw new HttpError(400, t("configMessages.settings_routes_03"));
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    const next = applyPermissions(current, validatePermissions(req.body, parsePermissions(current).defaultMode));
    const normalized = current === null ? null : applyPermissions(current, parsePermissions(current));
    return {
      diff: diffText(target.display, maskSettingsText(normalized), maskSettingsText(next)),
      changed: next !== normalized,
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
    };
  });

  app.put<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/permissions", async (req) => {
    if (configCli(req.query.cli) !== "claude") throw new HttpError(400, t("configMessages.settings_routes_04"));
    const repo = requireRepo();
    const target = settingsTarget(repo, scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return writeWithBackup({
      repo,
      target,
      next: applyPermissions(current, validatePermissions(req.body, parsePermissions(current).defaultMode)),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.permissions"),
      backups,
    });
  });
}
