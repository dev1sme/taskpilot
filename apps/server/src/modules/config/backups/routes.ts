import path from "node:path";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { locale, t } from "../../../core/i18n.js";
import { maskEntry, nativeMcpDocument, nativeMcpServers } from "../mcp/read.js";
import { nativeSettingsOf, readNativeFields } from "../settings/native.js";
import { CONFIG_ADAPTERS } from "../adapters/index.js";
import type { ProviderId } from "@taskpilot/shared";
import type { ConfigRouteOptions } from "../shared/http.js";
import { isAllowedPath } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { isObject } from "../../../core/values.js";
import type { BackupView, BackupDiff } from "./types.js";

/** Backups of every file TaskPilot wrote: list, diff against the current file, restore. */
export function registerBackupsRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  const restorable = (b: { path: string }, repo: string) => isAllowedPath(b.path, repo);

  app.get("/api/backups", async (): Promise<BackupView[]> => {
    const repo = requireRepo();
    return (await backups.list()).map((b) => ({ ...b, restorable: restorable(b, repo) }));
  });

  app.get<{ Params: { id: string } }>("/api/backups/:id/diff", async (req): Promise<BackupDiff> => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!restorable(entry, repo)) throw new HttpError(403, t("errors.otherRepoBackup"));
    const current = await readCurrent(entry.path);
    return { diff: diffText(entry.display, safeFile(entry.path, current), safeFile(entry.path, content), [t("diff.before"), t("diff.afterRestore")]), entry };
  });

  app.post<{ Params: { id: string } }>("/api/backups/:id/restore", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!restorable(entry, repo)) throw new HttpError(403, t("errors.otherRepoBackup"));
    const current = await readCurrent(entry.path);
    validateRestore(entry.path, content);
    return writeWithBackup({
      repo,
      target: { abs: entry.path, display: entry.display },
      next: content,
      baseHash: hashOf(current),
      reason: t("backup.beforeRestoreAt", { time: new Date(entry.at).toLocaleString(locale()) }),
      backups,
    });
  });
}

/** The CLI whose TOML config file (settings and MCP servers in one file) has this name. */
function tomlConfigOwner(file: string): ProviderId | undefined {
  return Object.values(CONFIG_ADAPTERS).find(
    (adapter) => adapter.settings.kind === "native" && adapter.settings.format === "toml" && file.endsWith(path.basename(adapter.settings.file("", "user"))),
  )?.id;
}

/** A backup diff is a safe projection, never a dump of unknown config fields. */
function safeFile(file: string, text: string | null): string | null {
  if (text === null) return null;
  const toml = tomlConfigOwner(file);
  if (toml) {
    try {
      const doc = nativeMcpDocument(text, toml);
      const mcp = nativeMcpServers(doc, toml);
      return `${JSON.stringify({ settings: readNativeFields(nativeSettingsOf(toml)!, "user", text), mcp_servers: Object.fromEntries(Object.entries(mcp).map(([name, value]) => [name, maskEntry(value)])) }, null, 2)}\n`;
    } catch {
      return t("configMessages.backups_routes_04");
    }
  }
  if (file.endsWith(".mcp.json") || file.endsWith("/mcp.json") || file.endsWith("mcp-config.json")) return maskMcpText(text);
  if (file.endsWith(".json")) {
    try {
      return `${JSON.stringify(redactJson(JSON.parse(text)), null, 2)}\n`;
    } catch {
      return t("configMessages.backups_routes_05");
    }
  }
  return text;
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactJson(child)]));
  return typeof value === "string" ? "••••" : value;
}

function validateRestore(file: string, content: string | null): void {
  if (content === null) return;
  const toml = tomlConfigOwner(file);
  if (toml) nativeMcpDocument(content, toml);
  else if (file.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch {
      throw new HttpError(409, t("configMessages.backups_routes_06"));
    }
  }
}

/** .mcp.json with every server's secrets masked (for backup diffs). */
function maskMcpText(text: string | null): string | null {
  if (text === null) return null;
  try {
    const doc = JSON.parse(text) as Record<string, unknown>;
    const servers = isObject(doc.mcpServers) ? doc.mcpServers : Object.values(doc).every(isObject) ? doc : {};
    return `${JSON.stringify({ mcpServers: Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, maskEntry(v)])) }, null, 2)}\n`;
  } catch {
    return t("errors.invalidJsonShort");
  }
}
