import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { parseConfigProvider } from "../shared/sections.js";
import { scopeOf, stringField, type ConfigRouteOptions } from "../shared/http.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { rawFile, type RawAddress, type RawFile } from "./files.js";

type AddressQuery = { cli?: string; section?: string; scope?: string; name?: string };

/** A raw config file as the editor opens it. */
export interface RawFileView {
  path: string;
  format: RawFile["format"];
  deletable: boolean;
  exists: boolean;
  content: string;
  /** Version token to send back on save; "absent" when the file does not exist. */
  hash: string;
}

/** The diff a save would make, and whether the file changed since it was read. */
export interface RawPreview {
  diff: string;
  changed: boolean;
  stale: boolean;
}

function addressOf(source: unknown): RawAddress {
  const q = (source ?? {}) as AddressQuery;
  if (q.cli !== undefined && typeof q.cli !== "string") throw new HttpError(400, t("configMessages.routes_01"));
  if (typeof q.section !== "string") throw new HttpError(400, t("errors.missing", { key: "section" }));
  if (typeof q.scope !== "string") throw new HttpError(400, t("errors.missing", { key: "scope" }));
  if (q.name !== undefined && typeof q.name !== "string") throw new HttpError(400, t("errors.missing", { key: "name" }));
  return { cli: parseConfigProvider(q.cli), section: q.section, scope: scopeOf(q.scope), ...(q.name ? { name: q.name } : {}) };
}

/**
 * Raw native config files: read, preview and write the text itself. The structured endpoints of
 * each section only show a file; this is the one way TaskPilot changes one. Every write checks the
 * file's syntax, refuses a file changed since it was read, and keeps a backup.
 */
export function registerRawRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get<{ Querystring: AddressQuery }>("/api/config/raw", async (req): Promise<RawFileView> => {
    const file = rawFile(requireRepo(), addressOf(req.query));
    const content = await readCurrent(file.target.abs);
    return { path: file.target.display, format: file.format, deletable: file.deletable, exists: content !== null, content: content ?? "", hash: hashOf(content) };
  });

  app.post("/api/config/raw/preview", async (req): Promise<RawPreview> => {
    const file = rawFile(requireRepo(), addressOf(req.body));
    const next = stringField(req.body, "content");
    const current = await readCurrent(file.target.abs);
    file.validate(next);
    return { diff: diffText(file.target.display, current, next), changed: current !== next, stale: hashOf(current) !== stringField(req.body, "baseHash") };
  });

  app.put("/api/config/raw", async (req) => {
    const repo = requireRepo();
    const file = rawFile(repo, addressOf(req.body));
    const next = stringField(req.body, "content");
    file.validate(next);
    return writeWithBackup({ repo, target: file.target, next, baseHash: stringField(req.body, "baseHash"), reason: t("backup.edit"), backups });
  });

  app.delete<{ Querystring: AddressQuery & { baseHash?: string } }>("/api/config/raw", async (req) => {
    const repo = requireRepo();
    const file = rawFile(repo, addressOf(req.query));
    if (!file.deletable) throw new HttpError(400, t("raw.notDeletable", { file: file.target.display }));
    return writeWithBackup({ repo, target: file.target, next: null, baseHash: req.query.baseHash ?? "", reason: t("backup.delete"), backups });
  });
}
