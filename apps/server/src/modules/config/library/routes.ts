import { readdir } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";

import { parseConfigProvider } from "../shared/sections.js";
import { PROVIDER_IDS, type ProviderId } from "@taskpilot/shared";
import { configAdapter } from "../adapters/index.js";
import type { ConfigRouteOptions } from "../shared/http.js";
import { libraryTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { readLibrary } from "./read.js";
import { checkCodexAgent } from "./check.js";
import { readTemplates, tomlMeta, type AgentTemplateProvider, type AgentTemplate } from "./templates.js";
import { isObject } from "../../../core/values.js";

/** Agents, commands and skills, and TaskPilot's subagent templates; items are edited through the raw endpoints. */
export function registerLibraryRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  app.get<{ Querystring: { cli?: string } }>("/api/config/agents", async (req) => readLibrary(requireRepo(), "agents", parseConfigProvider(req.query.cli)));
  app.get<{ Querystring: { cli?: string } }>("/api/config/commands", async (req) => readLibrary(requireRepo(), "commands", parseConfigProvider(req.query.cli)));
  app.get<{ Querystring: { cli?: string } }>("/api/config/skills", async (req) => readLibrary(requireRepo(), "skills", parseConfigProvider(req.query.cli)));

  /**
   * TaskPilot's subagents and how each compares with the repo's .claude/agents/<name>.md, or with
   * .codex/agents/<name>.toml when `?cli=codex`.
   */
  app.get<{ Querystring: { cli?: string } }>("/api/config/agents/templates", async (req) => {
    const repo = requireRepo();
    const cli = templatesOf(req.query.cli);
    const files = await Promise.all((await readTemplates(cli.templates)).map((tpl) => templateState(repo, tpl, cli.id)));
    return files.map(({ current: _, ...f }) => f);
  });

  /** The diff of writing the chosen templates (all when `names` is left out); `cli` in the body picks Codex. */
  app.post("/api/config/agents/templates/preview", async (req) => {
    const repo = requireRepo();
    const cli = templatesOf((req.body as { cli?: unknown } | null)?.cli);
    const files = await Promise.all((await chosenTemplates(req.body, cli.templates)).map((tpl) => templateState(repo, tpl, cli.id)));
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
    const cli = templatesOf(body.cli);
    const overwrite = Array.isArray(body.overwrite) ? body.overwrite.filter((n): n is string => typeof n === "string") : [];
    const hashes = isObject(body.hashes) ? body.hashes : {};
    const files = await Promise.all((await chosenTemplates(req.body, cli.templates)).map((tpl) => templateState(repo, tpl, cli.id)));

    const project = await projectAgents(repo, cli.id);
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
      const target = libraryTarget(repo, "agents", "project", f.rel, cli.id);
      await writeWithBackup({ repo, target, next: f.content, baseHash: f.hash, reason: t("backup.agentTemplates"), backups });
      written.push(target.display);
    }
    return { files: written, skipped: files.filter((f) => f.same).map((f) => f.path) };
  });
}

/** Templates named in the body's `names`, or all of them when it has none. */
async function chosenTemplates(body: unknown, cli: AgentTemplateProvider): Promise<AgentTemplate[]> {
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

/** The CLI whose TaskPilot subagent templates a request asks for (absent = Claude), and their kind. */
function templatesOf(v: unknown): { id: ProviderId; templates: AgentTemplateProvider } {
  const id = v === undefined ? "claude" : PROVIDER_IDS.find((cli) => cli === v);
  const templates = id && configAdapter(id).library.agents?.templates;
  if (!id || !templates) throw new HttpError(400, t("errors.invalidKind", { kind: String(v) }));
  return { id, templates };
}

/**
 * The repo's agents with the name each declares, to catch a name used twice. A TOML agent declares
 * `name` (else its file stem); a Markdown agent its frontmatter name, as the library reads it.
 */
async function projectAgents(repo: string, cli: ProviderId): Promise<{ name: string; rel: string; path: string }[]> {
  const library = configAdapter(cli).library.agents!;
  if (library.format !== "codex-agent") return (await readLibrary(repo, "agents", cli)).filter((a) => a.scope === "project");
  const root = library.roots(repo).find((r) => r.scope === "project" && r.editable)!;
  let files: string[];
  try {
    files = (await readdir(root.dir)).filter((n) => n.endsWith(".toml"));
  } catch {
    return [];
  }
  return Promise.all(
    files.map(async (rel) => {
      const target = libraryTarget(repo, "agents", "project", rel, cli);
      const meta = tomlMeta((await readCurrent(target.abs)) ?? "");
      return { name: typeof meta.name === "string" ? meta.name : rel.replace(/\.toml$/, ""), rel, path: target.display };
    }),
  );
}

async function templateState(repo: string, tpl: AgentTemplate, cli: ProviderId) {
  const target = libraryTarget(repo, "agents", "project", tpl.rel, cli);
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
    ...(configAdapter(cli).library.agents?.format === "codex-agent" ? { check: checkCodexAgent(tpl.content) } : {}),
  };
}
