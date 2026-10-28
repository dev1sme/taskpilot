import path from "node:path";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { locale, t } from "../../../core/i18n.js";
import { maskEntry } from "../mcp/edit.js";
import { claudeJsonEntry, nativeMcpDocument, nativeMcpServers } from "../mcp/read.js";
import { restoreMcpEntry } from "../mcp/routes.js";
import { nativeSettingsOf, readNativeFields } from "../settings/native.js";
import { CONFIG_ADAPTERS } from "../adapters/index.js";
import type { ProviderId } from "../../../core/providers.js";
import { claudeJson } from "../../../providers/claude/home.js";

import { NAME } from "../mcp/edit.js";
import type { ConfigRouteOptions } from "../shared/http.js";
import { isAllowedPath } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { isObject } from "../../../core/values.js";

/** Backups of every file TaskPilot wrote: list, diff against the current file, restore. */
export function registerBackupsRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  const restorable = (b: { path: string; mcp?: { scope: string; name: string; repo: string } }, repo: string) =>
    b.mcp ? b.path === claudeJson() && NAME.test(b.mcp.name) && (b.mcp.scope === "user" || (b.mcp.scope === "local" && b.mcp.repo === repo)) : isAllowedPath(b.path, repo);

  app.get("/api/backups", async () => {
    const repo = requireRepo();
    return (await backups.list()).map((b) => ({ ...b, restorable: restorable(b, repo) }));
  });

  app.get<{ Params: { id: string } }>("/api/backups/:id/diff", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!restorable(entry, repo)) throw new HttpError(403, t("errors.otherRepoBackup"));
    if (entry.mcp) {
      const show = (s: string | null) => safeEntry(s);
      const now = await currentMcpEntry(entry.mcp);
      return { diff: diffText(entry.display, show(now), show(content)), entry };
    }
    const current = await readCurrent(entry.path);
    return { diff: diffText(entry.display, safeFile(entry.path, current), safeFile(entry.path, content)), entry };
  });

  app.post<{ Params: { id: string } }>("/api/backups/:id/restore", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!restorable(entry, repo)) throw new HttpError(403, t("errors.otherRepoBackup"));
    if (entry.mcp) {
      if (content !== null && safeEntry(content) === t("configMessages.backups_routes_01")) throw new HttpError(409, t("configMessages.backups_routes_02"));
      await restoreMcpEntry({ mcp: entry.mcp }, content, backups);
      return { ok: true };
    }
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

function safeEntry(text: string | null): string | null {
  if (text === null) return null;
  try {
    const masked = maskEntry(JSON.parse(text));
    if (!masked) throw new Error("entry");
    return `${JSON.stringify(masked, null, 2)}\n`;
  } catch {
    return t("configMessages.backups_routes_03");
  }
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

async function currentMcpEntry(m: { scope: "local" | "user"; name: string; repo: string }): Promise<string | null> {
  const entry = await claudeJsonEntry(m.scope, m.repo, m.name);
  return entry ? JSON.stringify(entry, null, 2) : null;
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
