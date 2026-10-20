import type { FastifyInstance } from "fastify";
import { HttpError } from "../core/errors.js";
import type { EnvStore } from "../sessions/envStore.js";
import { BackupStore } from "./backups.js";
import { getCodegraphStatus, runCodegraphIndex } from "./codegraph.js";
import { applyHooks, readHookInputs, readHooksBlock, validateHooks } from "./hooksEdit.js";
import { readLibrary, type LibraryKind, type LibraryScope } from "./library.js";
import { registerMcpRoutes, restoreMcpEntry } from "./mcpRoutes.js";
import { readMemory, type MemoryScope } from "./memory.js";
import { applyPermissions, maskSettingsText, readPermissions, validatePermissions } from "./permissions.js";
import { readHooks, readSettings, type SettingsScope } from "./settings.js";
import { isAllowedPath, libraryTarget, memoryTarget, settingsTarget } from "./targets.js";
import { isObject } from "./fs.js";
import { claudeJsonEntry } from "./mcp.js";
import { maskEntry } from "./mcpEdit.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "./writer.js";
import { locale, t } from "../core/i18n.js";

const SCOPES = ["project", "local", "user"];

function scopeOf(raw: string): MemoryScope & SettingsScope {
  if (!SCOPES.includes(raw)) throw new HttpError(400, t("errors.invalidScope", { scope: raw }));
  return raw as MemoryScope & SettingsScope;
}

function stringField(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string") throw new HttpError(400, t("errors.missing", { key }));
  return v;
}

/** Claude configuration: reads (phase B), and edits with diff preview, backups and conflict checks (phase C). */
export function registerConfigRoutes(
  app: FastifyInstance,
  opts: { requireRepo: () => string; backups: BackupStore; envStore: EnvStore },
) {
  const { requireRepo, backups } = opts;
  registerMcpRoutes(app, opts);

  app.get("/api/config/memory", async () => readMemory(requireRepo()));
  app.get("/api/config/settings", async () => readSettings(requireRepo()));
  app.get("/api/config/hooks", async () => readHooks(requireRepo()));
  app.get("/api/config/agents", async () => readLibrary(requireRepo(), "agents"));
  app.get("/api/config/commands", async () => readLibrary(requireRepo(), "commands"));
  app.get("/api/config/skills", async () => readLibrary(requireRepo(), "skills"));
  app.get("/api/config/codegraph", async () => getCodegraphStatus(requireRepo()));
  app.post("/api/config/codegraph/index", async () => runCodegraphIndex(requireRepo()));

  // ---------------------------------------------------------------- CLAUDE.md

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

  // ---------------------------------------------------------------- permissions

  app.get<{ Params: { scope: string } }>("/api/config/settings/:scope/permissions", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), ...readPermissions(current) };
  });

  app.post<{ Params: { scope: string } }>("/api/config/settings/:scope/permissions/preview", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    const next = applyPermissions(current, validatePermissions(req.body));
    return {
      diff: diffText(target.display, maskSettingsText(current === null ? null : applyPermissions(current, readPermissions(current))), maskSettingsText(next)),
      changed: next !== current,
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
    };
  });

  app.put<{ Params: { scope: string } }>("/api/config/settings/:scope/permissions", async (req) => {
    const repo = requireRepo();
    const target = settingsTarget(repo, scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return writeWithBackup({
      repo,
      target,
      next: applyPermissions(current, validatePermissions(req.body)),
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.permissions"),
      backups,
    });
  });

  // ---------------------------------------------------------------- hooks

  app.get<{ Params: { scope: string } }>("/api/config/settings/:scope/hooks", async (req) => {
    const target = settingsTarget(requireRepo(), scopeOf(req.params.scope));
    const current = await readCurrent(target.abs);
    return { path: target.display, exists: current !== null, hash: hashOf(current), hooks: readHookInputs(current), raw: readHooksBlock(current) };
  });

  app.post<{ Params: { scope: string } }>("/api/config/settings/:scope/hooks/preview", async (req) => {
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

  app.put<{ Params: { scope: string } }>("/api/config/settings/:scope/hooks", async (req) => {
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

  // ---------------------------------------------------------------- agents, commands, skills

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

  // ---------------------------------------------------------------- backups

  const restorable = (b: { path: string; mcp?: { scope: string; repo: string } }, repo: string) =>
    b.mcp ? b.mcp.scope === "user" || b.mcp.repo === repo : isAllowedPath(b.path, repo);

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
