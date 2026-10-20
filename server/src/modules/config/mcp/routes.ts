import type { FastifyInstance } from "fastify";
import path from "node:path";
import { HttpError } from "../../../core/errors.js";
import type { EnvStore } from "../../env/index.js";
import type { BackupStore } from "../backups/store.js";
import { checkMcp, runClaude } from "../../../core/claude/cli.js";
import { claudeJson, displayPath, isObject, maskValue } from "../shared/fs.js";
import { claudeJsonEntry, readMcp } from "./read.js";
import { buildEntry, maskEntry, validateEntry } from "./edit.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { t } from "../../../core/i18n.js";

type McpScope = "project" | "local" | "user";

function scopeOf(raw: string): McpScope {
  if (raw !== "project" && raw !== "local" && raw !== "user") throw new HttpError(400, t("errors.invalidScope", { scope: raw }));
  return raw;
}

function baseHashOf(body: unknown): string {
  const v = (body as Record<string, unknown> | null)?.baseHash;
  if (typeof v !== "string") throw new HttpError(400, t("errors.missing", { key: "baseHash" }));
  return v;
}

/**
 * MCP servers: project servers live in .mcp.json (written by TaskPilot, with backups); local and
 * user servers live in ~/.claude.json and are changed only through `claude mcp`, with the
 * previous entry kept as a backup. Secrets of project servers go to TaskPilot's env store.
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  opts: { requireRepo: () => string; backups: BackupStore; envStore: EnvStore },
) {
  const { requireRepo, backups, envStore } = opts;
  const projectFile = (repo: string) => path.join(repo, ".mcp.json");

  /** Current entry of a server and the version token the editor must send back. */
  async function current(repo: string, scope: McpScope, name: string) {
    if (scope === "project") {
      const text = await readCurrent(projectFile(repo));
      const doc = parseMcpFile(text);
      const servers = isObject(doc.mcpServers) ? doc.mcpServers : {};
      return { entry: isObject(servers[name]) ? servers[name] : null, hash: hashOf(text), text, doc };
    }
    const entry = await claudeJsonEntry(scope, repo, name);
    return { entry, hash: hashOf(entry ? JSON.stringify(entry) : null), text: null, doc: null };
  }

  app.get("/api/config/mcp", async () => {
    const repo = requireRepo();
    return readMcp(repo, await envStore.forRepo(repo));
  });

  /** One server for the edit form: values masked, credentials in args/url hidden. */
  app.get<{ Params: { scope: string; name: string } }>("/api/config/mcp/:scope/:name", async (req) => {
    const repo = requireRepo();
    const scope = scopeOf(req.params.scope);
    const { entry, hash } = await current(repo, scope, req.params.name);
    if (!entry) throw new HttpError(404, t("mcp.notFound", { name: req.params.name }));
    const masked = maskEntry(entry)!;
    const rows = (v: unknown) =>
      isObject(v) ? Object.entries(v).map(([key, val]) => ({ key, ...maskValue(val) })) : [];
    return {
      name: req.params.name,
      scope,
      type: typeof entry.type === "string" ? entry.type : typeof entry.command === "string" ? "stdio" : "http",
      command: entry.command,
      args: masked.args ?? [],
      url: masked.url,
      env: rows(entry.env),
      headers: rows(entry.headers),
      hash,
    };
  });

  /** Hash of the place a new server would be added, for the "add server" form. */
  app.get<{ Params: { scope: string } }>("/api/config/mcp/:scope", async (req) => {
    const repo = requireRepo();
    const scope = scopeOf(req.params.scope);
    if (scope === "project") return { hash: hashOf(await readCurrent(projectFile(repo))) };
    return { hash: "absent" };
  });

  async function plan(repo: string, scope: McpScope, body: unknown) {
    const input = validateEntry(body);
    const original = input.originalName ?? input.name;
    const before = await current(repo, scope, original);
    if (input.originalName && !before.entry) throw new HttpError(404, t("mcp.notFound", { name: original }));
    if (input.name !== original || !input.originalName) {
      const clash = await current(repo, scope, input.name);
      if (clash.entry) throw new HttpError(409, t("mcp.exists", { name: input.name }));
    }
    const { entry, secrets } = buildEntry(input, before.entry, scope);
    return { input, original, before, entry, secrets };
  }

  app.post<{ Params: { scope: string } }>("/api/config/mcp/:scope/preview", async (req) => {
    const repo = requireRepo();
    const scope = scopeOf(req.params.scope);
    const { input, original, before, entry, secrets } = await plan(repo, scope, req.body);
    if (scope === "project") {
      const next = withServer(before.doc!, original, input.name, entry);
      return {
        diff: diffText(".mcp.json", maskMcpFile(before.text), maskMcpFile(next)),
        changed: next !== before.text,
        stale: before.hash !== baseHashOf(req.body),
        secrets: Object.keys(secrets),
      };
    }
    const label = `~/.claude.json › ${scope} › ${input.name}`;
    const show = (e: unknown) => (e ? `${JSON.stringify(maskEntry(e), null, 2)}\n` : null);
    return {
      diff: diffText(label, show(before.entry), show(entry)),
      changed: JSON.stringify(before.entry) !== JSON.stringify(entry),
      stale: before.hash !== baseHashOf(req.body),
      secrets: [],
    };
  });

  app.put<{ Params: { scope: string } }>("/api/config/mcp/:scope", async (req) => {
    const repo = requireRepo();
    const scope = scopeOf(req.params.scope);
    const { input, original, before, entry, secrets } = await plan(repo, scope, req.body);
    if (before.hash !== baseHashOf(req.body)) throw new HttpError(409, t("mcp.changedOutside"));

    if (scope === "project") {
      const result = await writeWithBackup({
        repo,
        target: { abs: projectFile(repo), display: ".mcp.json" },
        next: withServer(before.doc!, original, input.name, entry),
        baseHash: before.hash,
        reason: t("backup.mcpEdit", { name: input.name }),
        backups,
      });
      for (const [k, v] of Object.entries(secrets)) await envStore.set(repo, k, v);
      return result;
    }

    const backup = await backupEntry(repo, scope, original, before.entry, t("backup.mcpEdit", { name: input.name }));
    if (before.entry) await runClaude(["mcp", "remove", "--scope", scope, original], { cwd: repo });
    await runClaude(["mcp", "add-json", "--scope", scope, input.name, JSON.stringify(entry)], { cwd: repo });
    return { hash: hashOf(JSON.stringify(entry)), backup };
  });

  app.delete<{ Params: { scope: string; name: string }; Querystring: { baseHash?: string } }>(
    "/api/config/mcp/:scope/:name",
    async (req) => {
      const repo = requireRepo();
      const scope = scopeOf(req.params.scope);
      const name = req.params.name;
      const before = await current(repo, scope, name);
      if (!before.entry) throw new HttpError(404, t("mcp.notFound", { name }));
      if (before.hash !== req.query.baseHash) throw new HttpError(409, t("mcp.changedOutside"));
      if (scope === "project") {
        return writeWithBackup({
          repo,
          target: { abs: projectFile(repo), display: ".mcp.json" },
          next: withServer(before.doc!, name, null, null),
          baseHash: before.hash,
          reason: t("backup.mcpDelete", { name }),
          backups,
        });
      }
      const backup = await backupEntry(repo, scope, name, before.entry, t("backup.mcpDelete", { name }));
      await runClaude(["mcp", "remove", "--scope", scope, name], { cwd: repo });
      return { hash: "absent", backup };
    },
  );

  /** Connection status as Claude reports it (`claude mcp get`); only the status is returned. */
  app.post<{ Params: { name: string } }>("/api/config/mcp/check/:name", async (req) => {
    const repo = requireRepo();
    if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(req.params.name)) throw new HttpError(400, t("mcp.invalidServerName"));
    return checkMcp(req.params.name, { cwd: repo, env: await envStore.forRepo(repo) });
  });

  async function backupEntry(repo: string, scope: "local" | "user", name: string, entry: unknown, reason: string) {
    return backups.save(
      { abs: claudeJson(), display: `${displayPath(claudeJson(), repo)} › ${scope} › ${name}` },
      entry ? JSON.stringify(entry, null, 2) : null,
      reason,
      { scope, name, repo },
    );
  }
}

/** Restores an MCP entry backup through `claude mcp` (called from the backups route). */
export async function restoreMcpEntry(
  backup: { mcp: { scope: "local" | "user"; name: string; repo: string } },
  content: string | null,
  backups: BackupStore,
): Promise<void> {
  const { scope, name, repo } = backup.mcp;
  const now = await claudeJsonEntry(scope, repo, name);
  await backups.save(
    { abs: claudeJson(), display: `${displayPath(claudeJson(), repo)} › ${scope} › ${name}` },
    now ? JSON.stringify(now, null, 2) : null,
    t("backup.beforeRestore"),
    backup.mcp,
  );
  if (now) await runClaude(["mcp", "remove", "--scope", scope, name], { cwd: repo });
  if (content !== null) await runClaude(["mcp", "add-json", "--scope", scope, name, content], { cwd: repo });
}

function parseMcpFile(text: string | null): Record<string, unknown> {
  if (text === null || !text.trim()) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new HttpError(409, t("mcp.notJson", { error: (e as Error).message }));
  }
  if (!isObject(doc)) throw new HttpError(409, t("mcp.notObject"));
  return doc;
}

/** .mcp.json text with server `from` replaced by `to` (null = removed); other keys kept. */
function withServer(doc: Record<string, unknown>, from: string, to: string | null, entry: unknown): string {
  const servers = { ...(isObject(doc.mcpServers) ? doc.mcpServers : {}) };
  const ordered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(servers)) {
    if (k === from) {
      if (to !== null) ordered[to] = entry;
    } else ordered[k] = v;
  }
  if (to !== null && !(to in ordered)) ordered[to] = entry;
  return `${JSON.stringify({ ...doc, mcpServers: ordered }, null, 2)}\n`;
}

function maskMcpFile(text: string | null): string | null {
  if (text === null) return null;
  let doc: Record<string, unknown>;
  try {
    doc = parseMcpFile(text);
  } catch {
    return t("errors.invalidJsonShort");
  }
  const servers = isObject(doc.mcpServers) ? doc.mcpServers : {};
  const masked = Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, maskEntry(v) ?? v]));
  return `${JSON.stringify({ ...doc, mcpServers: masked }, null, 2)}\n`;
}
