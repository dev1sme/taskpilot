import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { stringField, type ConfigRouteOptions } from "../shared/http.js";
import { libraryTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { readLibrary, type LibraryKind, type LibraryScope } from "./read.js";

/** Agents, commands and skills. */
export function registerLibraryRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get("/api/config/agents", async () => readLibrary(requireRepo(), "agents"));
  app.get("/api/config/commands", async () => readLibrary(requireRepo(), "commands"));
  app.get("/api/config/skills", async () => readLibrary(requireRepo(), "skills"));

  const libraryOf = (kind: string, scope: string, rel: string) => {
    if (kind !== "agents" && kind !== "commands" && kind !== "skills") throw new HttpError(400, t("errors.invalidKind", { kind }));
    if (scope !== "project" && scope !== "user") throw new HttpError(400, t("errors.invalidScope", { scope }));
    return libraryTarget(requireRepo(), kind as LibraryKind, scope as LibraryScope, rel);
  };

  app.get<{ Params: { kind: string; scope: string }; Querystring: { rel?: string } }>(
    "/api/config/library/:kind/:scope/raw",
    async (req) => {
      const target = libraryOf(req.params.kind, req.params.scope, req.query.rel ?? "");
      const content = await readCurrent(target.abs);
      return { path: target.display, exists: content !== null, content: content ?? "", hash: hashOf(content) };
    },
  );

  app.post<{ Params: { kind: string; scope: string } }>("/api/config/library/:kind/:scope/preview", async (req) => {
    const target = libraryOf(req.params.kind, req.params.scope, stringField(req.body, "rel"));
    const next = stringField(req.body, "content");
    const current = await readCurrent(target.abs);
    return { diff: diffText(target.display, current, next), changed: current !== next, stale: hashOf(current) !== stringField(req.body, "baseHash") };
  });

  app.put<{ Params: { kind: string; scope: string } }>("/api/config/library/:kind/:scope", async (req) => {
    const repo = requireRepo();
    const target = libraryOf(req.params.kind, req.params.scope, stringField(req.body, "rel"));
    return writeWithBackup({
      repo,
      target,
      next: stringField(req.body, "content"),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.edit"),
      backups,
    });
  });

  app.delete<{ Params: { kind: string; scope: string }; Querystring: { rel?: string; baseHash?: string } }>(
    "/api/config/library/:kind/:scope",
    async (req) => {
      const repo = requireRepo();
      const target = libraryOf(req.params.kind, req.params.scope, req.query.rel ?? "");
      return writeWithBackup({ repo, target, next: null, baseHash: req.query.baseHash ?? "", reason: t("backup.delete"), backups });
    },
  );
}
