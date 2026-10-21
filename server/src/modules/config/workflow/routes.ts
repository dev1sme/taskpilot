import { rm, rmdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import {
  DEFAULT_WORKFLOW_DIR,
  LEADER_WORKFLOW_DIR,
  OVERRIDE_DIR,
  PROMPT_TEXT,
  WORKFLOW_FILE,
  hasOverride,
  overrideDir,
  parseWorkflowFiles,
  promptVars,
  readWorkflowDir,
  reportOf,
  renderPrompt,
  templateVars,
  type ParseResult,
} from "../../workflow/index.js";
import { displayPath, isObject } from "../shared/fs.js";
import { stringField, type ConfigRouteOptions } from "../shared/http.js";
import { workflowTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";

/**
 * The workflow page: TaskPilot's built-in workflow (read only) or the repo's override in
 * .claude/taskpilot/, which is created as a copy of the built-in one and then edited file by file.
 */
export function registerWorkflowConfigRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  /** The override's files with `drafts` laid over them (null removes a file), and how they parse. */
  const check = async (repo: string, drafts: Record<string, string | null> = {}) => {
    const dir = overrideDir(repo);
    const files = await readWorkflowDir(dir);
    const before = parseWorkflowFiles(files, { dir, origin: "repo" });
    for (const [name, text] of Object.entries(drafts)) {
      if (text === null) files.delete(name);
      else files.set(name, text);
    }
    return { files, before, after: parseWorkflowFiles(files, { dir, origin: "repo" }) };
  };

  /** Refuses a change that adds errors; errors the override already had (edited by hand) do not block fixing them one file at a time. */
  const refuseNewErrors = ({ before, after }: { before: ParseResult; after: ParseResult }) => {
    const added = after.errors.filter((e) => !before.errors.includes(e));
    if (added.length) throw new HttpError(400, t("errors.workflowInvalid", { errors: added.join("; ") }));
  };

  const requireOverride = (repo: string) => {
    if (!hasOverride(repo)) throw new HttpError(409, t("errors.noOverride"));
  };

  app.get("/api/config/workflow", async () => {
    const repo = requireRepo();
    const origin = hasOverride(repo) ? "repo" : "default";
    const dir = origin === "repo" ? overrideDir(repo) : DEFAULT_WORKFLOW_DIR;
    const files = await readWorkflowDir(dir);
    const defaults = origin === "repo" ? await readWorkflowDir(DEFAULT_WORKFLOW_DIR) : files;
    const { def, errors, warnings } = parseWorkflowFiles(files, { dir, origin });
    /** Where a file is used: step titles for prompts, document files for skeletons, the history file. */
    const usedBy = (name: string) => [
      ...(def?.steps.filter((s) => s.promptFile === name || s.onRejectFile === name || s.dispatch?.promptFile === name).map((s) => s.title) ?? []),
      ...(def?.steps.flatMap((s) => s.outputs).filter((o) => o.format === name).map((o) => o.file) ?? []),
      ...(def?.steps.filter((s) => s.dispatch?.format === name).map((s) => s.dispatch!.report) ?? []),
      ...(def?.history.format === name ? [def.history.file] : []),
    ];
    return {
      origin,
      overrideDir: OVERRIDE_DIR.split(path.sep).join("/"),
      dir: displayPath(dir, repo),
      errors,
      warnings,
      variables: templateVars,
      newPrompt: PROMPT_TEXT.newPrompt,
      def: def && {
        agent: def.agent,
        permissionMode: def.permissionMode ?? null,
        history: { file: def.history.file, entry: def.history.entry, format: def.history.format ?? null },
        language: def.language,
        rules: def.rules,
        restart: def.restart ?? null,
        steps: def.steps.map((s) => ({
          id: s.id,
          title: s.title,
          agent: s.agent,
          gate: s.gate,
          doneWhen: s.doneWhen?.output ?? null,
          outputs: s.outputs.map((o) => ({ id: o.id, file: o.file, content: o.content, format: o.format ?? null })),
          promptFile: s.promptFile,
          onRejectFile: s.onRejectFile ?? null,
          dispatch: s.dispatch && { from: s.dispatch.from, promptFile: s.dispatch.promptFile, report: s.dispatch.report, format: s.dispatch.format ?? null, parallel: s.dispatch.parallel },
        })),
      },
      files: [...files].map(([name, content]) => ({
        name,
        path: displayPath(path.join(dir, name), repo),
        content,
        hash: hashOf(content),
        usedBy: name === WORKFLOW_FILE ? [] : usedBy(name),
        sameAsDefault: defaults.has(name) ? defaults.get(name) === content : null,
      })),
    };
  });

  app.get<{ Querystring: { name?: string } }>("/api/config/workflow/file", async (req) => {
    const repo = requireRepo();
    const name = req.query.name ?? "";
    const target = workflowTarget(repo, name);
    const content = await readCurrent(target.abs);
    const fallback = await readCurrent(path.join(DEFAULT_WORKFLOW_DIR, name));
    return { path: target.display, exists: content !== null, content: content ?? "", hash: hashOf(content), defaultContent: fallback };
  });

  /**
   * Copies a template (the built-in workflow, or the leader / member one) into .claude/taskpilot/:
   * prompts first, workflow.yml last, so the override only takes effect complete.
   */
  app.post("/api/config/workflow/override", async (req) => {
    const repo = requireRepo();
    const template = (req.body as { template?: unknown } | null)?.template ?? "default";
    if (template !== "default" && template !== "leader") throw new HttpError(400, t("errors.missing", { key: "template" }));
    const dir = overrideDir(repo);
    const display = displayPath(dir, repo);
    if (hasOverride(repo)) throw new HttpError(409, t("errors.overrideExists", { dir: display }));
    const source = await readWorkflowDir(template === "leader" ? LEADER_WORKFLOW_DIR : DEFAULT_WORKFLOW_DIR);
    const existing = await readWorkflowDir(dir);
    const clash = [...source.keys()].filter((n) => existing.has(n));
    if (clash.length) throw new HttpError(409, t("errors.overrideConflict", { dir: display, files: clash.join(", ") }));

    const names = [...source.keys()].sort((a, b) => Number(a === WORKFLOW_FILE) - Number(b === WORKFLOW_FILE));
    const written: string[] = [];
    try {
      for (const name of names) {
        const target = workflowTarget(repo, name);
        await writeWithBackup({ repo, target, next: source.get(name)!, baseHash: hashOf(null), reason: t("backup.overrideCreate"), backups });
        written.push(target.abs);
      }
    } catch (e) {
      await Promise.all(written.map((f) => rm(f, { force: true })));
      throw e;
    }
    return { files: names.map((n) => workflowTarget(repo, n).display) };
  });

  /** Removes the whole override (back to the built-in workflow); every file is backed up first. */
  app.post("/api/config/workflow/reset", async (req) => {
    const repo = requireRepo();
    requireOverride(repo);
    const hashes = (req.body as { hashes?: unknown } | null)?.hashes;
    if (!isObject(hashes)) throw new HttpError(400, t("errors.missing", { key: "hashes" }));
    const dir = overrideDir(repo);
    const files = await readWorkflowDir(dir);
    for (const [name, content] of files) {
      if (hashes[name] !== hashOf(content)) throw new HttpError(409, t("errors.overrideChanged", { file: name }));
    }
    // workflow.yml first: from then on the repo follows the built-in workflow even if a later delete fails.
    const names = [...files.keys()].sort((a, b) => Number(b === WORKFLOW_FILE) - Number(a === WORKFLOW_FILE));
    for (const name of names) {
      await writeWithBackup({
        repo,
        target: workflowTarget(repo, name),
        next: null,
        baseHash: hashOf(files.get(name)!),
        reason: t("backup.overrideReset"),
        backups,
      });
    }
    await rmdir(dir).catch(() => undefined);
    return { files: names };
  });

  app.post("/api/config/workflow/validate", async (req) => {
    const repo = requireRepo();
    requireOverride(repo);
    const name = stringField(req.body, "name");
    workflowTarget(repo, name);
    const { after } = await check(repo, { [name]: stringField(req.body, "content") });
    return { errors: after.errors, warnings: after.warnings };
  });

  app.post("/api/config/workflow/preview", async (req) => {
    const repo = requireRepo();
    requireOverride(repo);
    const name = stringField(req.body, "name");
    const target = workflowTarget(repo, name);
    const next = stringField(req.body, "content");
    const result = await check(repo, { [name]: next });
    refuseNewErrors(result);
    const current = await readCurrent(target.abs);
    return {
      diff: diffText(target.display, current, next),
      changed: current !== next,
      stale: hashOf(current) !== stringField(req.body, "baseHash"),
      warnings: result.after.warnings,
    };
  });

  app.put("/api/config/workflow/file", async (req) => {
    const repo = requireRepo();
    requireOverride(repo);
    const name = stringField(req.body, "name");
    const next = stringField(req.body, "content");
    refuseNewErrors(await check(repo, { [name]: next }));
    return writeWithBackup({
      repo,
      target: workflowTarget(repo, name),
      next,
      baseHash: stringField(req.body, "baseHash"),
      reason: t("backup.edit"),
      backups,
    });
  });

  app.delete<{ Querystring: { name?: string; baseHash?: string } }>("/api/config/workflow/file", async (req) => {
    const repo = requireRepo();
    requireOverride(repo);
    const name = req.query.name ?? "";
    if (name === WORKFLOW_FILE) throw new HttpError(400, t("errors.workflowFileDelete"));
    const target = workflowTarget(repo, name);
    refuseNewErrors(await check(repo, { [name]: null }));
    return writeWithBackup({ repo, target, next: null, baseHash: req.query.baseHash ?? "", reason: t("backup.delete"), backups });
  });

  app.get<{ Querystring: { name?: string } }>("/api/config/workflow/default-diff", async (req) => {
    const repo = requireRepo();
    const target = workflowTarget(repo, req.query.name ?? "");
    const ours = await readCurrent(target.abs);
    const builtIn = await readCurrent(path.join(DEFAULT_WORKFLOW_DIR, path.basename(target.abs)));
    return { diff: diffText(target.display, builtIn, ours), same: ours === builtIn };
  });

  /**
   * The prompt a step would send, for a sample task, from the workflow in use with unsaved `drafts`
   * laid over it. `restart` adds what a run after "Chạy lại từ đầu" is told, with every document archived.
   */
  app.post("/api/config/workflow/render", async (req) => {
    const repo = requireRepo();
    const body = (req.body ?? {}) as { drafts?: unknown; feedback?: unknown; restart?: unknown };
    const stepId = stringField(req.body, "stepId");
    const kind = stringField(req.body, "kind");
    const drafts = isObject(body.drafts) ? (body.drafts as Record<string, string>) : {};
    let parsed: ParseResult;
    if (hasOverride(repo)) parsed = (await check(repo, drafts)).after;
    else parsed = parseWorkflowFiles(await readWorkflowDir(DEFAULT_WORKFLOW_DIR), { dir: DEFAULT_WORKFLOW_DIR, origin: "default" });
    if (!parsed.def) throw new HttpError(400, t("errors.workflowInvalid", { errors: parsed.errors.join("; ") }));
    const def = parsed.def;
    const index = def.steps.findIndex((s) => s.id === stepId);
    if (index < 0) throw new HttpError(404, t("errors.stepNotFound", { step: stepId }));
    const step = def.steps[index];
    if (!!step.dispatch !== (kind === "subtask")) throw new HttpError(404, t("errors.stepNotFound", { step: stepId }));
    const template = step.dispatch ? step.dispatch.prompt : kind === "onReject" ? step.onReject : step.prompt;
    if (template === undefined) throw new HttpError(404, t("errors.noOnReject", { step: step.title }));
    const feedback = kind === "onReject" ? (typeof body.feedback === "string" && body.feedback.trim() ? body.feedback : PROMPT_TEXT.sampleFeedback) : undefined;
    const previous = body.restart === true ? { dir: PROMPT_TEXT.sampleArchive, files: def.steps.flatMap((s) => s.outputs.map((o) => o.file)).sort() } : undefined;
    const subtask = step.dispatch && { ...PROMPT_TEXT.sampleSubtask, files: [...PROMPT_TEXT.sampleSubtask.files], phase: "pending" as const, report: reportOf(step.dispatch.report, PROMPT_TEXT.sampleSubtask.n) };
    return { task: PROMPT_TEXT.sampleTask, text: renderPrompt(template, promptVars(def, index, PROMPT_TEXT.sampleTask, { feedback, previous, subtask, subtasks: subtask && [subtask] })) };
  });
}
