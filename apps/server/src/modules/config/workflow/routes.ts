import { rmdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import {
  CUSTOM_MODE,
  DEFAULT_MODE,
  ExecutionValidationError,
  OVERRIDE_DIR,
  PROMPT_TEXT,
  WORKFLOW_FILE,
  classifyOverride,
  composeWorkflow,
  guessBase,
  isMode,
  listModes,
  migrateLegacy,
  modeDir,
  overrideDir,
  parseExecution,
  parseRepoSettings,
  patchRepoSettings,
  promptVars,
  readOverride,
  readRepoSettings,
  readWorkflowDir,
  reportOf,
  renderPrompt,
  resolveMode,
  resolveExecution,
  selectExecution,
  settingsText,
  templateVars,
  type Composed,
  type ModeInfo,
  type OverrideInfo,
} from "../../workflow/index.js";
import { displayPath } from "../shared/fs.js";
import { stringField, type ConfigRouteOptions } from "../shared/http.js";
import { repoSettingsTarget, workflowTarget } from "../shared/targets.js";
import { diffText, hashOf, readCurrent, writeWithBackup } from "../shared/writer.js";
import { subagentsOf } from "../library/read.js";
import { isObject } from "../../../core/values.js";
import type { ExecutionDefaults, WorkflowModes, WorkflowFileView, WorkflowChecks, WorkflowSavePreview, MigrationPreview, RenderedPrompt } from "./types.js";

/** The mode an existing override belongs to: the one it extends, or "custom" for a complete one. */
const targetMode = (info: OverrideInfo) => (info.kind === "extends" ? info.extends : CUSTOM_MODE);

/** The new override file: `extends` a mode and nothing else yet. */
const overrideTemplate = (mode: string, name: string) =>
  `# Override of the "${name}" workflow: write only what differs from it.
# - top-level keys written here (agent, permission-mode, language, rules, history, restart) replace the mode's;
# - a step with an id of the mode patches that step (only the keys written; outputs by output id);
# - a step with a new id needs \`before:\` or \`after:\` (the id of a step) to say where it goes;
# - a prompt or format file of this directory replaces the mode's file of the same name.
# The dispatch step belongs to TaskPilot: only its title and dispatch.prompt / format / parallel can change.
version: 2
extends: ${mode}
`;

/** The mode the repo chose, from its .taskpilot/settings.yml. */
const selectedOf = async (repo: string) => (await readRepoSettings(repo)).mode;

/** A mode the repo can run: a workflows/ directory, or "custom" while it has a complete override. */
const requireMode = (info: OverrideInfo, mode: string) => {
  if (mode === CUSTOM_MODE ? info.kind !== "legacy" : !isMode(mode)) throw new HttpError(400, t("errors.unknownMode", { mode }));
};

/** The modes to offer: the built-in ones, and "custom" while the repo has a complete override. */
const modesOf = async (info: OverrideInfo): Promise<ModeInfo[]> => [
  ...(await listModes()),
  ...(info.kind === "legacy" ? [{ id: CUSTOM_MODE, name: t("workflow.customMode"), description: "" }] : []),
];

/** The workflow files the override is compared with: its mode's, or the default mode's for a complete override. */
const baseOf = (info: OverrideInfo) => modeDir(info.kind === "extends" ? info.extends : DEFAULT_MODE);

/** The workflow page's view of one mode: its files (the repo's override when it applies), parsed definition and checks. */
async function readWorkflowConfig(repo: string, mode: string | undefined) {
  const info = await readOverride(repo);
  const selected = resolveMode(info, await selectedOf(repo));
  const modeId = mode || selected;
  requireMode(info, modeId);
  const composed = await composeWorkflow(repo, modeId, info);
  const { def, errors, warnings } = composed.parsed;
  // An override that applies to this mode is shown (and edited) as the repo wrote it; any other mode as TaskPilot ships it.
  const applies = composed.mode.override;
  const origin = applies ? "repo" : "default";
  const dir = applies ? overrideDir(repo) : modeDir(modeId);
  const files = applies ? info.files : composed.files;
  const defaults = applies ? await readWorkflowDir(baseOf(info)) : files;
  /** Where a file is used: step titles for prompts, document files for skeletons, the history file. */
  const usedBy = (name: string) => [
    ...(def?.steps.filter((s) => s.promptFile === name || s.onRejectFile === name || s.dispatch?.promptFile === name).map((s) => s.title) ?? []),
    ...(def?.steps
      .flatMap((s) => s.outputs)
      .filter((o) => o.format === name)
      .map((o) => o.file) ?? []),
    ...(def?.steps.filter((s) => s.dispatch?.format === name).map((s) => s.dispatch!.report) ?? []),
    ...(def?.history.format === name ? [def.history.file] : []),
  ];
  return {
    origin,
    mode: composed.mode,
    modes: await modesOf(info),
    selected,
    overrideKind: info.kind,
    overrideExtends: info.kind === "extends" ? info.extends : null,
    provenance: composed.provenance ?? null,
    overrideDir: OVERRIDE_DIR.split(path.sep).join("/"),
    settingsPath: repoSettingsTarget(repo).display,
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
    /** Every file of the workflow as it runs (the mode's, with the override laid over it). */
    resolved: Object.fromEntries(composed.files),
    files: [...files].map(([name, content]) => ({
      name,
      path: displayPath(path.join(dir, name), repo),
      content,
      hash: hashOf(content),
      usedBy: name === WORKFLOW_FILE ? [] : usedBy(name),
      sameAsDefault: defaults.has(name) ? defaults.get(name) === content : null,
      provenance: applies && info.kind === "extends" ? (composed.provenance?.files[name] ?? null) : null,
    })),
  };
}

/** GET /api/config/workflow. */
export type WorkflowConfigView = Awaited<ReturnType<typeof readWorkflowConfig>>;

/**
 * The workflow page: TaskPilot's modes (workflows/<id>/, read only), and the repo's override in
 * .taskpilot/ — `extends: <mode>` with only what differs from that mode, or a complete (legacy)
 * workflow — edited file by file.
 */
export function registerWorkflowConfigRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo, backups } = opts;

  /** The override's files with `drafts` laid over them (null removes a file). */
  const withDrafts = (info: OverrideInfo, drafts: Record<string, string | null>): OverrideInfo => {
    if (Object.keys(drafts).length === 0) return info;
    const files = new Map(info.files);
    for (const [name, text] of Object.entries(drafts)) {
      if (text === null) files.delete(name);
      else files.set(name, text);
    }
    return classifyOverride(files);
  };

  /** How the override parses (merged with its base for `extends`), before and after `drafts`. */
  const check = async (repo: string, drafts: Record<string, string | null> = {}) => {
    const info = await readOverride(repo);
    const next = withDrafts(info, drafts);
    const [before, after] = await Promise.all([composeWorkflow(repo, targetMode(info), info), composeWorkflow(repo, targetMode(next), next)]);
    return { before: before.parsed, after: after.parsed, files: next.files };
  };

  /** Refuses a change that adds errors; errors the override already had (edited by hand) do not block fixing them one file at a time. */
  const refuseNewErrors = ({ before, after }: { before: Composed["parsed"]; after: Composed["parsed"] }) => {
    const added = after.errors.filter((e) => !before.errors.includes(e));
    if (added.length) throw new HttpError(400, t("errors.workflowInvalid", { errors: added.join("; ") }));
  };

  const requireOverride = async (repo: string) => {
    if ((await readOverride(repo)).kind === "none") throw new HttpError(409, t("errors.noOverride"));
  };

  app.get("/api/config/workflow/modes", async (): Promise<WorkflowModes> => {
    const repo = requireRepo();
    const info = await readOverride(repo);
    const target = repoSettingsTarget(repo);
    const current = await readCurrent(target.abs);
    return {
      modes: await modesOf(info),
      selected: resolveMode(info, current === null ? undefined : parseRepoSettings(current).mode),
      override: { kind: info.kind, extends: info.kind === "extends" ? info.extends : null },
      hash: hashOf(current),
      settingsPath: target.display,
    };
  });

  app.put("/api/config/workflow/mode", async (req) => {
    const repo = requireRepo();
    const mode = stringField(req.body, "mode");
    requireMode(await readOverride(repo), mode);
    const target = repoSettingsTarget(repo);
    const current = await readCurrent(target.abs);
    // Older clients send only mode; newer ones can also guard against edits since loading.
    const baseHash = isObject(req.body) && req.body.baseHash !== undefined ? stringField(req.body, "baseHash") : hashOf(current);
    if (baseHash !== hashOf(current)) throw new HttpError(409, t("errors.changedOutside", { file: target.display }));
    const next = settingsText(mode, current);
    if (current !== next) await writeWithBackup({ repo, target, next, baseHash, reason: t("backup.modeChange"), backups });
    return { selected: mode, settingsPath: target.display, hash: hashOf(next) };
  });

  /** Absent defaults are distinct from an explicit workflow choice; invalid settings stay visible. */
  const executionDefaults = (repo: string, current: string | null): ExecutionDefaults => {
    const settings = current === null ? {} : parseRepoSettings(current);
    return {
      execution: settings.execution ?? null,
      executionVersion: settings.executionVersion ?? null,
      errors: settings.errors ?? [],
      hash: hashOf(current),
      settingsPath: repoSettingsTarget(repo).display,
    };
  };

  app.get("/api/config/workflow/execution-defaults", async () => {
    const repo = requireRepo();
    return executionDefaults(repo, await readCurrent(repoSettingsTarget(repo).abs));
  });

  app.put("/api/config/workflow/execution-defaults", async (req) => {
    const repo = requireRepo();
    const body = req.body;
    if (!isObject(body) || !Object.hasOwn(body, "execution") || Object.keys(body).some((key) => key !== "execution" && key !== "baseHash")) {
      throw new HttpError(400, t("errors.missing", { key: "execution, baseHash" }));
    }
    const baseHash = stringField(body, "baseHash");
    const target = repoSettingsTarget(repo);
    const current = await readCurrent(target.abs);
    if (baseHash !== hashOf(current)) throw new HttpError(409, t("errors.changedOutside", { file: target.display }));
    const execution = body.execution === null ? null : parseExecution(body.execution);
    const next = patchRepoSettings(current, { execution });
    const settings = parseRepoSettings(next);
    if (settings.errors?.length) throw new ExecutionValidationError(settings.errors);
    const written = current === next ? undefined : await writeWithBackup({ repo, target, next, baseHash, reason: t("backup.edit"), backups });
    return { ...executionDefaults(repo, next), ...(written ? { backup: written.backup } : {}) };
  });

  app.get<{ Querystring: { mode?: string } }>("/api/config/workflow", async (req) => readWorkflowConfig(requireRepo(), req.query.mode));

  app.get<{ Querystring: { name?: string } }>("/api/config/workflow/file", async (req): Promise<WorkflowFileView> => {
    const repo = requireRepo();
    const name = req.query.name ?? "";
    const target = workflowTarget(repo, name);
    const content = await readCurrent(target.abs);
    const fallback = await readCurrent(path.join(baseOf(await readOverride(repo)), name));
    return { path: target.display, exists: content !== null, content: content ?? "", hash: hashOf(content), defaultContent: fallback };
  });

  /**
   * Creates the repo's override: one file, workflow.yml with `extends: <mode>`. (`template` is the
   * name this field had before modes.)
   */
  app.post("/api/config/workflow/override", async (req) => {
    const repo = requireRepo();
    const body = (req.body as { mode?: unknown; template?: unknown } | null) ?? {};
    const mode = body.mode ?? body.template ?? DEFAULT_MODE;
    if (!isMode(mode)) throw new HttpError(400, t("errors.unknownMode", { mode: String(mode) }));
    const dir = overrideDir(repo);
    const display = displayPath(dir, repo);
    if ((await readOverride(repo)).kind !== "none") throw new HttpError(409, t("errors.overrideExists", { dir: display }));
    // A file of the mode's own name would replace the mode's silently.
    const existing = await readWorkflowDir(dir);
    const clash = [...(await readWorkflowDir(modeDir(mode))).keys()].filter((n) => existing.has(n));
    if (clash.length) throw new HttpError(409, t("errors.overrideConflict", { dir: display, files: clash.join(", ") }));
    const name = (await listModes()).find((m) => m.id === mode)?.name ?? mode;
    const target = workflowTarget(repo, WORKFLOW_FILE);
    await writeWithBackup({ repo, target, next: overrideTemplate(mode, name), baseHash: hashOf(null), reason: t("backup.overrideCreate"), backups });
    return { files: [target.display] };
  });

  /**
   * Rewrites a complete (legacy) override as `extends`: only what differs from the base mode. Without
   * `apply`, previews it (a diff, and the errors that stop it); with it, writes workflow.yml and then
   * removes the files identical to the base's, each backed up. Every step in between is a valid
   * workflow that runs the same, so a failure part-way leaves nothing broken.
   */
  app.post("/api/config/workflow/override/migrate", async (req): Promise<MigrationPreview> => {
    const repo = requireRepo();
    const info = await readOverride(repo);
    if (info.kind !== "legacy") throw new HttpError(409, t("errors.overrideNotLegacy"));
    const body = (req.body as { base?: unknown; apply?: unknown; hashes?: unknown } | null) ?? {};
    const base = body.base === undefined ? guessBase(info.files) : body.base;
    if (!isMode(base)) throw new HttpError(400, t("errors.migrateBase", { base: String(base) }));
    const migration = migrateLegacy(info.files, await readWorkflowDir(modeDir(base)), base);
    const next = migration.files.get(WORKFLOW_FILE) ?? "";
    const current = info.files.get(WORKFLOW_FILE) ?? "";
    const target = workflowTarget(repo, WORKFLOW_FILE);
    const diff = [diffText(target.display, current, next), ...migration.remove.map((name) => diffText(workflowTarget(repo, name).display, info.files.get(name) ?? "", null))].join("\n");
    const result = { base, errors: migration.errors, diff, remove: migration.remove };
    if (body.apply !== true || migration.errors.length) return { ...result, applied: false };

    const hashes = body.hashes;
    if (!isObject(hashes)) throw new HttpError(400, t("errors.missing", { key: "hashes" }));
    for (const [name, content] of info.files) {
      if (hashes[name] !== hashOf(content)) throw new HttpError(409, t("errors.overrideChanged", { file: name }));
    }
    const reason = t("backup.overrideMigrate");
    await writeWithBackup({ repo, target, next, baseHash: hashOf(current), reason, backups });
    for (const name of migration.remove) {
      await writeWithBackup({ repo, target: workflowTarget(repo, name), next: null, baseHash: hashOf(info.files.get(name)!), reason, backups });
    }
    return { ...result, applied: true };
  });

  /** Removes the whole override (back to the built-in workflow); every file is backed up first. settings.yml stays: it is the repo's chosen mode, not part of the override. */
  app.post("/api/config/workflow/reset", async (req) => {
    const repo = requireRepo();
    await requireOverride(repo);
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

  app.post("/api/config/workflow/validate", async (req): Promise<WorkflowChecks> => {
    const repo = requireRepo();
    await requireOverride(repo);
    const name = stringField(req.body, "name");
    workflowTarget(repo, name);
    const { after } = await check(repo, { [name]: stringField(req.body, "content") });
    return { errors: after.errors, warnings: after.warnings };
  });

  app.post("/api/config/workflow/preview", async (req): Promise<WorkflowSavePreview> => {
    const repo = requireRepo();
    await requireOverride(repo);
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
    await requireOverride(repo);
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
    await requireOverride(repo);
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
    const builtIn = await readCurrent(path.join(baseOf(await readOverride(repo)), path.basename(target.abs)));
    return { diff: diffText(target.display, builtIn, ours, [t("diff.builtIn"), t("diff.override")]), same: ours === builtIn };
  });

  /**
   * The prompt a step would send, for a sample task, from the workflow of `mode` (the repo's mode when
   * absent) with unsaved `drafts` laid over the override. `restart` adds what a run after "Chạy lại từ
   * đầu" is told, with every document archived.
   */
  app.post("/api/config/workflow/render", async (req): Promise<RenderedPrompt> => {
    const repo = requireRepo();
    const body = (req.body ?? {}) as { drafts?: unknown; feedback?: unknown; restart?: unknown; mode?: unknown; execution?: unknown };
    const stepId = stringField(req.body, "stepId");
    const kind = stringField(req.body, "kind");
    const drafts = isObject(body.drafts) ? (body.drafts as Record<string, string>) : {};
    const info = await readOverride(repo);
    const modeId = typeof body.mode === "string" && body.mode ? body.mode : resolveMode(info, await selectedOf(repo));
    requireMode(info, modeId);
    const parsed = (await composeWorkflow(repo, modeId, info.kind === "none" ? info : withDrafts(info, drafts))).parsed;
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
    // The config editor previews YAML alone unless the caller explicitly supplies run policy.
    const selected = selectExecution(body.execution);
    const subtask = step.dispatch && {
      ...PROMPT_TEXT.sampleSubtask,
      ...(selected.execution.agent === "workflow" ? {} : selected.execution),
      files: [...PROMPT_TEXT.sampleSubtask.files],
      phase: "pending" as const,
      report: reportOf(step.dispatch.report, PROMPT_TEXT.sampleSubtask.n),
    };
    const effective = resolveExecution({
      workflow: def,
      scope: subtask ? { kind: "subtask", stepId, n: subtask.n } : { kind: "step", stepId },
      run: { execution: selected.execution },
      assignment: subtask || undefined,
    });
    // promptVars still consumes workflow settings; project only a copy for this preview.
    const previewDef = { ...def, steps: def.steps.map((s, i) => (i === index ? { ...s, agent: effective.agent, model: effective.model } : s)) };
    // The repo's real subagents, as a run would list them to the leader.
    const subagents = template.includes("{{subagents}}") ? await subagentsOf(repo) : undefined;
    return {
      task: PROMPT_TEXT.sampleTask,
      execution: selected.execution,
      source: selected.source,
      effective,
      text: renderPrompt(template, promptVars(previewDef, index, PROMPT_TEXT.sampleTask, { feedback, previous, subtask, subtasks: subtask && [subtask], subagents })),
    };
  });
}
