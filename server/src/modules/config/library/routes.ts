import { readdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { isObject } from "../shared/fs.js";
import { stringField, type ConfigRouteOptions } from "../shared/http.js";
import { codexAgentTarget, libraryTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { readLibrary, type LibraryKind, type LibraryScope } from "./read.js";
import { checkCodexAgent } from "./check.js";
import { readTemplates, tomlMeta, type AgentCli, type AgentTemplate } from "./templates.js";

/** Agents, commands and skills. */
export function registerLibraryRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get("/api/config/agents", async () => readLibrary(requireRepo(), "agents"));
  app.get("/api/config/commands", async () => readLibrary(requireRepo(), "commands"));
  app.get("/api/config/skills", async () => readLibrary(requireRepo(), "skills"));

  /**
   * TaskPilot's subagents and how each compares with the repo's .claude/agents/<name>.md, or with
   * .codex/agents/<name>.toml when `?cli=codex`.
   */
  app.get<{ Querystring: { cli?: string } }>("/api/config/agents/templates", async (req) => {
    const repo = requireRepo();
    const cli = cliOf(req.query.cli);
    const files = await Promise.all((await readTemplates(cli)).map((tpl) => templateState(repo, tpl, cli)));
    return files.map(({ current: _, ...f }) => f);
  });

  /** The diff of writing the chosen templates (all when `names` is left out); `cli` in the body picks Codex. */
  app.post("/api/config/agents/templates/preview", async (req) => {
    const repo = requireRepo();
    const cli = cliOf((req.body as { cli?: unknown } | null)?.cli);
    const files = await Promise.all((await chosenTemplates(req.body, cli)).map((tpl) => templateState(repo, tpl, cli)));
    const diff = files
      .filter((f) => !f.same)
      .map((f) => diffText(f.path, f.current, f.content))
      .join("\n");
    return { files: files.map(({ current: _, content: __, ...f }) => f), diff };
  });

  /**
   * Writes the chosen templates to .claude/agents/ (.codex/agents/ for `cli: "codex"`). A file that exists is overwritten only when
   * named in `overwrite`, and only if it still has the hash the preview showed (`hashes`);
   * otherwise nothing is written (409). Every write is backed up; files already equal are skipped.
   */
  app.post("/api/config/agents/templates/install", async (req) => {
    const repo = requireRepo();
    const body = (req.body as { overwrite?: unknown; hashes?: unknown; cli?: unknown } | null) ?? {};
    const cli = cliOf(body.cli);
    const overwrite = Array.isArray(body.overwrite) ? body.overwrite.filter((n): n is string => typeof n === "string") : [];
    const hashes = isObject(body.hashes) ? body.hashes : {};
    const files = await Promise.all((await chosenTemplates(req.body, cli)).map((tpl) => templateState(repo, tpl, cli)));

    const project = cli === "codex" ? await codexProjectAgents(repo) : (await readLibrary(repo, "agents")).filter((a) => a.scope === "project");
    for (const f of files) {
      const other = project.find((a) => a.name === f.name && a.rel !== f.rel);
      if (other) throw new HttpError(409, t("errors.agentTemplateNameTaken", { name: f.name, file: other.path }));
    }
    const clash = files.filter((f) => f.exists && !f.same && !overwrite.includes(f.name));
    if (clash.length) throw new HttpError(409, t("errors.agentTemplateExists", { files: clash.map((f) => f.path).join(", ") }));
    for (const f of files) {
      if (f.exists && !f.same && hashes[f.name] !== f.hash) throw new HttpError(409, t("errors.agentTemplateChanged", { file: f.path }));
    }

    const written: string[] = [];
    for (const f of files.filter((x) => !x.same)) {
      const target = cli === "codex" ? codexAgentTarget(repo, f.rel) : libraryTarget(repo, "agents", "project", f.rel);
      await writeWithBackup({ repo, target, next: f.content, baseHash: f.hash, reason: t("backup.agentTemplates"), backups });
      written.push(target.display);
    }
    return { files: written, skipped: files.filter((f) => f.same).map((f) => f.path) };
  });

  const libraryOf = (kind: string, scope: string, rel: string) => {
    if (kind !== "agents" && kind !== "commands" && kind !== "skills") throw new HttpError(400, t("errors.invalidKind", { kind }));
    if (scope !== "project" && scope !== "user") throw new HttpError(400, t("errors.invalidScope", { scope }));
    return libraryTarget(requireRepo(), kind as LibraryKind, scope as LibraryScope, rel);
  };

  app.get<{ Params: { kind: string; scope: string }; Querystring: { rel?: string } }>("/api/config/library/:kind/:scope/raw", async (req) => {
    const target = libraryOf(req.params.kind, req.params.scope, req.query.rel ?? "");
    const content = await readCurrent(target.abs);
    return { path: target.display, exists: content !== null, content: content ?? "", hash: hashOf(content) };
  });

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

  app.delete<{ Params: { kind: string; scope: string }; Querystring: { rel?: string; baseHash?: string } }>("/api/config/library/:kind/:scope", async (req) => {
    const repo = requireRepo();
    const target = libraryOf(req.params.kind, req.params.scope, req.query.rel ?? "");
    return writeWithBackup({ repo, target, next: null, baseHash: req.query.baseHash ?? "", reason: t("backup.delete"), backups });
  });
}

/** Templates named in the body's `names`, or all of them when it has none. */
async function chosenTemplates(body: unknown, cli: AgentCli): Promise<AgentTemplate[]> {
  const all = await readTemplates(cli);
  const names = (body as { names?: unknown } | null)?.names;
  if (names === undefined) return all;
  if (!Array.isArray(names)) throw new HttpError(400, t("errors.missing", { key: "names" }));
  return [...new Set(names)].map((name) => {
    const tpl = all.find((x) => x.name === name);
    if (!tpl) throw new HttpError(400, t("errors.unknownAgentTemplate", { name: String(name) }));
    return tpl;
  });
}

function cliOf(v: unknown): AgentCli {
  if (v === undefined || v === "claude") return "claude";
  if (v === "codex") return "codex";
  throw new HttpError(400, t("errors.invalidKind", { kind: String(v) }));
}

/** The repo's .codex/agents/*.toml with the name each file declares, to catch a name used twice. */
async function codexProjectAgents(repo: string): Promise<{ name: string; rel: string; path: string }[]> {
  let files: string[];
  try {
    files = (await readdir(path.join(repo, ".codex", "agents"))).filter((n) => n.endsWith(".toml"));
  } catch {
    return [];
  }
  return Promise.all(
    files.map(async (rel) => {
      const target = codexAgentTarget(repo, rel);
      const meta = tomlMeta((await readCurrent(target.abs)) ?? "");
      return { name: typeof meta.name === "string" ? meta.name : rel.replace(/\.toml$/, ""), rel, path: target.display };
    }),
  );
}

async function templateState(repo: string, tpl: AgentTemplate, cli: AgentCli = "claude") {
  const target = cli === "codex" ? codexAgentTarget(repo, tpl.rel) : libraryTarget(repo, "agents", "project", tpl.rel);
  const current = await readCurrent(target.abs);
  return {
    name: tpl.name,
    rel: tpl.rel,
    description: tpl.description,
    path: target.display,
    exists: current !== null,
    same: current === tpl.content,
    /** Hash of the repo's file, to send back when overwriting it. */
    hash: hashOf(current),
    current,
    content: tpl.content,
    ...(cli === "codex" ? { check: checkCodexAgent(tpl.content) } : {}),
  };
}
