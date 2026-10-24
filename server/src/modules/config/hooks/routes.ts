import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { maskSettingsText } from "../settings/permissions.js";
import { readHooks } from "../settings/read.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { hookTarget, settingsTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { configCli, markConfigAvailable } from "../shared/agent.js";
import { applyCopilotHooks, copilotDiffView, listCopilotHookFiles, readCopilotHookFile, readCopilotHooks } from "./copilot.js";
import { applyHooks, readHookInputs, readHooksBlock, validateCopilotHooks, validateHooks } from "./edit.js";

/** Command hooks of each settings file. */
export function registerConfigHooksRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;
  markConfigAvailable("copilot", "hooks");

  app.get<{ Querystring: { cli?: string } }>("/api/config/hooks", async (req) => (configCli(req.query.cli) === "copilot" ? listCopilotHookFiles(requireRepo()) : readHooks(requireRepo())));

  const copilotFile = (repo: string, scopeRaw: string, name: string) => {
    const scope = scopeOf(scopeRaw);
    if (name === "taskpilot.json") throw new HttpError(403, t("configMessages.hooks_routes_01"));
    return hookTarget(repo, scope, name, "copilot");
  };
  app.get<{ Params: { scope: string; name: string }; Querystring: { cli?: string } }>("/api/config/hooks/:scope/:name", async (req) => {
    if (configCli(req.query.cli) !== "copilot") throw new HttpError(400, t("configMessages.hooks_routes_02"));
    const repo = requireRepo();
    const target = copilotFile(repo, req.params.scope, req.params.name);
    const current = await readCopilotHookFile(repo, target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), hooks: readCopilotHooks(current) };
  });

  app.post<{ Params: { scope: string; name: string }; Querystring: { cli?: string } }>("/api/config/hooks/:scope/:name/preview", async (req) => {
    if (configCli(req.query.cli) !== "copilot") throw new HttpError(400, t("configMessages.hooks_routes_03"));
    const repo = requireRepo();
    const target = copilotFile(repo, req.params.scope, req.params.name);
    const current = await readCopilotHookFile(repo, target.abs);
    const next = applyCopilotHooks(current, validateCopilotHooks(req.body));
    const before = copilotDiffView(current);
    const after = copilotDiffView(next);
    return { diff: diffText(target.display, before, after), changed: before !== after, stale: hashOf(current) !== stringField(req.body, "baseHash") };
  });

  app.put<{ Params: { scope: string; name: string }; Querystring: { cli?: string } }>("/api/config/hooks/:scope/:name", async (req) => {
    if (configCli(req.query.cli) !== "copilot") throw new HttpError(400, t("configMessages.hooks_routes_04"));
    const repo = requireRepo();
    const target = copilotFile(repo, req.params.scope, req.params.name);
    const current = await readCopilotHookFile(repo, target.abs);
    return writeWithBackup({
      repo,
      target,
      next: applyCopilotHooks(current, validateCopilotHooks(req.body)),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.hooks"),
      backups,
    });
  });

  app.get<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/hooks", async (req) => {
    if (configCli(req.query.cli) !== "claude") throw new HttpError(400, t("configMessages.hooks_routes_05"));
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), hooks: readHookInputs(current), raw: readHooksBlock(current) };
  });

  app.post<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/hooks/preview", async (req) => {
    if (configCli(req.query.cli) !== "claude") throw new HttpError(400, t("configMessages.hooks_routes_06"));
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

  app.put<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/hooks", async (req) => {
    if (configCli(req.query.cli) !== "claude") throw new HttpError(400, t("configMessages.hooks_routes_07"));
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
