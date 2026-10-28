import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { maskSettingsText } from "../settings/permissions.js";
import { readHooks } from "../settings/read.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { hookTarget, settingsTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { parseConfigProvider } from "../shared/provider-capabilities.js";
import { configAdapter } from "../adapters/index.js";
import type { ProviderId } from "../../../core/providers.js";
import { applyCopilotHooks, copilotDiffView, listHookFiles, readCopilotHookFile, readCopilotHooks, type FileHooks } from "./copilot.js";
import { applyHooks, parseHookInputs, readHooksBlock, validateCopilotHooks, validateHooks } from "./edit.js";

/** Command hooks of each settings file. */
export function registerConfigHooksRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;
  app.get<{ Querystring: { cli?: string } }>("/api/config/hooks", async (req) => {
    const cli = parseConfigProvider(req.query.cli);
    const hooks = configAdapter(cli).hooks;
    return hooks?.kind === "files" ? listHookFiles(requireRepo(), cli, hooks) : readHooks(requireRepo());
  });

  /** The CLI's hook files, when it keeps hooks in files of their own; `message` refuses the others. */
  const fileHooks = (raw: string | undefined, message: () => string): { cli: ProviderId; hooks: FileHooks } => {
    const cli = parseConfigProvider(raw);
    const hooks = configAdapter(cli).hooks;
    if (hooks?.kind !== "files") throw new HttpError(400, message());
    return { cli, hooks };
  };
  /** Hooks inside the settings files (Claude). */
  const settingsHooks = (raw: string | undefined, message: () => string) => {
    if (configAdapter(parseConfigProvider(raw)).hooks?.kind !== "settings") throw new HttpError(400, message());
  };
  const hookFile = (repo: string, cli: ProviderId, hooks: FileHooks, scopeRaw: string, name: string) => {
    const scope = scopeOf(scopeRaw);
    if (hooks.reserved.includes(name)) throw new HttpError(403, t("configMessages.hooks_routes_01"));
    return hookTarget(repo, scope, name, cli);
  };
  app.get<{ Params: { scope: string; name: string }; Querystring: { cli?: string } }>("/api/config/hooks/:scope/:name", async (req) => {
    const { cli, hooks } = fileHooks(req.query.cli, () => t("configMessages.hooks_routes_02"));
    const repo = requireRepo();
    const target = hookFile(repo, cli, hooks, req.params.scope, req.params.name);
    const current = await readCopilotHookFile(repo, target.abs, hooks);
    return { path: target.display, exists: current !== null, hash: hashOf(current), hooks: readCopilotHooks(current) };
  });

  app.post<{ Params: { scope: string; name: string }; Querystring: { cli?: string } }>("/api/config/hooks/:scope/:name/preview", async (req) => {
    const { cli, hooks } = fileHooks(req.query.cli, () => t("configMessages.hooks_routes_03"));
    const repo = requireRepo();
    const target = hookFile(repo, cli, hooks, req.params.scope, req.params.name);
    const current = await readCopilotHookFile(repo, target.abs, hooks);
    const next = applyCopilotHooks(current, validateCopilotHooks(req.body));
    const before = copilotDiffView(current);
    const after = copilotDiffView(next);
    return { diff: diffText(target.display, before, after), changed: before !== after, stale: hashOf(current) !== stringField(req.body, "baseHash") };
  });

  app.put<{ Params: { scope: string; name: string }; Querystring: { cli?: string } }>("/api/config/hooks/:scope/:name", async (req) => {
    const { cli, hooks } = fileHooks(req.query.cli, () => t("configMessages.hooks_routes_04"));
    const repo = requireRepo();
    const target = hookFile(repo, cli, hooks, req.params.scope, req.params.name);
    const current = await readCopilotHookFile(repo, target.abs, hooks);
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
    settingsHooks(req.query.cli, () => t("configMessages.hooks_routes_05"));
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), hooks: parseHookInputs(current), raw: readHooksBlock(current) };
  });

  app.post<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/hooks/preview", async (req) => {
    settingsHooks(req.query.cli, () => t("configMessages.hooks_routes_06"));
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    const next = applyHooks(current, validateHooks(req.body));
    const normalized = current === null ? null : applyHooks(current, parseHookInputs(current));
    return {
      diff: diffText(target.display, maskSettingsText(normalized), maskSettingsText(next)),
      changed: next !== normalized,
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
    };
  });

  app.put<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/settings/:scope/hooks", async (req) => {
    settingsHooks(req.query.cli, () => t("configMessages.hooks_routes_07"));
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
