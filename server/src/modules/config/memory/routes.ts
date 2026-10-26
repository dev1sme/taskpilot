import type { FastifyInstance } from "fastify";
import { t } from "../../../core/i18n.js";
import { parseConfigProvider, markConfigAvailable } from "../shared/provider-capabilities.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { memoryTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { readMemory } from "./read.js";

/** Native instruction files: read, preview and edit with backups. */
export function registerMemoryRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;
  markConfigAvailable("codex", "memory");
  markConfigAvailable("copilot", "memory");

  app.get<{ Querystring: { cli?: string } }>("/api/config/memory", async (req) => readMemory(requireRepo(), parseConfigProvider(req.query.cli)));

  app.get<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/memory/:scope/raw", async (req) => {
    const target = memoryTarget(requireRepo(), scopeOf(req.params.scope), parseConfigProvider(req.query.cli));
    const content = await readCurrent(target.abs);
    return { path: target.display, exists: content !== null, content: content ?? "", hash: hashOf(content) };
  });

  app.post<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/memory/:scope/preview", async (req) => {
    const target = memoryTarget(requireRepo(), scopeOf(req.params.scope), parseConfigProvider(req.query.cli));
    const next = stringField(req.body, "content");
    const current = await readCurrent(target.abs);
    return { diff: diffText(target.display, current, next), changed: current !== next, stale: hashOf(current) !== stringField(req.body, "baseHash") };
  });

  app.put<{ Params: { scope: string }; Querystring: { cli?: string } }>("/api/config/memory/:scope", async (req) => {
    const repo = requireRepo();
    const target = memoryTarget(repo, scopeOf(req.params.scope), parseConfigProvider(req.query.cli));
    return writeWithBackup({
      repo,
      target,
      next: stringField(req.body, "content"),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.edit"),
      backups,
    });
  });
}
