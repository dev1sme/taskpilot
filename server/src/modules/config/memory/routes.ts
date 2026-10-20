import type { FastifyInstance } from "fastify";
import { t } from "../../../core/i18n.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { memoryTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { readMemory } from "./read.js";

/** CLAUDE.md files: read, and edit with diff preview and backups. */
export function registerMemoryRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get("/api/config/memory", async () => readMemory(requireRepo()));

  app.get<{ Params: { scope: string } }>("/api/config/memory/:scope/raw", async (req) => {
    const target = memoryTarget(requireRepo(), scopeOf(req.params.scope));
    const content = await readCurrent(target.abs);
    return { path: target.display, exists: content !== null, content: content ?? "", hash: hashOf(content) };
  });

  app.post<{ Params: { scope: string } }>("/api/config/memory/:scope/preview", async (req) => {
    const target = memoryTarget(requireRepo(), scopeOf(req.params.scope));
    const next = stringField(req.body, "content");
    const current = await readCurrent(target.abs);
    return { diff: diffText(target.display, current, next), changed: current !== next, stale: hashOf(current) !== stringField(req.body, "baseHash") };
  });

  app.put<{ Params: { scope: string } }>("/api/config/memory/:scope", async (req) => {
    const repo = requireRepo();
    const target = memoryTarget(repo, scopeOf(req.params.scope));
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
