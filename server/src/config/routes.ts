import type { FastifyInstance } from "fastify";
import { HttpError } from "../errors.js";
import { BackupStore } from "./backups.js";
import { readLibrary } from "./library.js";
import { readMcp } from "./mcp.js";
import { readMemory, type MemoryScope } from "./memory.js";
import { applyPermissions, maskSettingsText, readPermissions, validatePermissions } from "./permissions.js";
import { readHooks, readSettings, type SettingsScope } from "./settings.js";
import { isAllowedPath, memoryTarget, settingsTarget } from "./targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "./writer.js";

const SCOPES = ["project", "local", "user"];

function scopeOf(raw: string): MemoryScope & SettingsScope {
  if (!SCOPES.includes(raw)) throw new HttpError(400, `Phạm vi không hợp lệ: ${raw}`);
  return raw as MemoryScope & SettingsScope;
}

function stringField(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string") throw new HttpError(400, `Thiếu ${key}`);
  return v;
}

/** Claude configuration: reads (phase B), and edits with diff preview, backups and conflict checks (phase C). */
export function registerConfigRoutes(app: FastifyInstance, opts: { requireRepo: () => string; backups: BackupStore }) {
  const { requireRepo, backups } = opts;

  app.get("/api/config/memory", async () => readMemory(requireRepo()));
  app.get("/api/config/settings", async () => readSettings(requireRepo()));
  app.get("/api/config/hooks", async () => readHooks(requireRepo()));
  app.get("/api/config/agents", async () => readLibrary(requireRepo(), "agents"));
  app.get("/api/config/commands", async () => readLibrary(requireRepo(), "commands"));
  app.get("/api/config/skills", async () => readLibrary(requireRepo(), "skills"));
  app.get("/api/config/mcp", async () => readMcp(requireRepo()));

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
      reason: "Sửa trong TaskPilot",
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
      reason: "Sửa quyền trong TaskPilot",
      backups,
    });
  });

  // ---------------------------------------------------------------- backups

  app.get("/api/backups", async () => {
    const repo = requireRepo();
    return (await backups.list()).map((b) => ({ ...b, restorable: isAllowedPath(b.path, repo) }));
  });

  app.get<{ Params: { id: string } }>("/api/backups/:id/diff", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!isAllowedPath(entry.path, repo)) throw new HttpError(403, "Backup này thuộc repo khác");
    const current = await readCurrent(entry.path);
    const mask = entry.path.endsWith(".json") ? maskSettingsText : (s: string | null) => s;
    return { diff: diffText(entry.display, mask(current), mask(content)), entry };
  });

  app.post<{ Params: { id: string } }>("/api/backups/:id/restore", async (req) => {
    const repo = requireRepo();
    const { entry, content } = await backups.get(req.params.id);
    if (!isAllowedPath(entry.path, repo)) throw new HttpError(403, "Backup này thuộc repo khác");
    const current = await readCurrent(entry.path);
    return writeWithBackup({
      repo,
      target: { abs: entry.path, display: entry.display },
      next: content,
      baseHash: hashOf(current),
      reason: `Trước khi khôi phục bản lúc ${new Date(entry.at).toLocaleString("vi-VN")}`,
      backups,
    });
  });
}
