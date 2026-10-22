import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { locale, t } from "../../../core/i18n.js";
import { maskEntry } from "../mcp/edit.js";
import { claudeJsonEntry } from "../mcp/read.js";
import { restoreMcpEntry } from "../mcp/routes.js";
import { maskSettingsText } from "../settings/permissions.js";
import { isObject } from "../shared/fs.js";
import type { ConfigRouteOptions } from "../shared/http.js";
import { isAllowedPath } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";

/** Backups of every file TaskPilot wrote: list, diff against the current file, restore. */
export function registerBackupsRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  const restorable = (b: { path: string; mcp?: { scope: string; repo: string } }, repo: string) => (b.mcp ? b.mcp.scope === "user" || b.mcp.repo === repo : isAllowedPath(b.path, repo));

  app.get("/api/backups", async () => {
    const repo = requireRepo();
    return (await backups.list()).map((b) => ({ ...b, restorable: restorable(b, repo) }));
  });

  app.get<{ Params: { id: string } }>("/api/backups/:id/diff", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!restorable(entry, repo)) throw new HttpError(403, t("errors.otherRepoBackup"));
    if (entry.mcp) {
      const show = (s: string | null) => (s === null ? null : `${JSON.stringify(maskEntry(JSON.parse(s)), null, 2)}\n`);
      const now = await currentMcpEntry(entry.mcp);
      return { diff: diffText(entry.display, show(now), show(content)), entry };
    }
    const current = await readCurrent(entry.path);
    const mask = entry.path.endsWith(".mcp.json") ? maskMcpText : entry.path.endsWith(".json") ? maskSettingsText : (s: string | null) => s;
    return { diff: diffText(entry.display, mask(current), mask(content)), entry };
  });

  app.post<{ Params: { id: string } }>("/api/backups/:id/restore", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!restorable(entry, repo)) throw new HttpError(403, t("errors.otherRepoBackup"));
    if (entry.mcp) {
      await restoreMcpEntry({ mcp: entry.mcp }, content, backups);
      return { ok: true };
    }
    const current = await readCurrent(entry.path);
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

async function currentMcpEntry(m: { scope: "local" | "user"; name: string; repo: string }): Promise<string | null> {
  const entry = await claudeJsonEntry(m.scope, m.repo, m.name);
  return entry ? JSON.stringify(entry, null, 2) : null;
}

/** .mcp.json with every server's secrets masked (for backup diffs). */
function maskMcpText(text: string | null): string | null {
  if (text === null) return null;
  try {
    const doc = JSON.parse(text) as Record<string, unknown>;
    const servers = isObject(doc.mcpServers) ? doc.mcpServers : {};
    return `${JSON.stringify({ ...doc, mcpServers: Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, maskEntry(v) ?? v])) }, null, 2)}\n`;
  } catch {
    return t("errors.invalidJsonShort");
  }
}
