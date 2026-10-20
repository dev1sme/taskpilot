import { ArrowCounterClockwise, CheckCircle, Eye, FilePlus, GitDiff, PencilSimple, Play, Plus, Trash, Warning } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "../../../shared/api/queryClient";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { toast } from "../../../shared/ui/Toast";
import { useWorkspace } from "../../workspace";
import { clearDraft, getDraft, isDirty, setDraft, useDrafts } from "../shared/drafts";
import { ConfigHeader, ConfigToolbar, DraftControls, LoadError } from "../shared/parts";
import { useConfig } from "../shared/useConfig";
import { useSaveFlow } from "../shared/useSaveFlow";
import { workflowConfigApi } from "./api";
import type { WorkflowConfig, WorkflowDraft, WorkflowFile } from "./types";
import "../shared/code-view.css";
import "../shared/library-view.css";
import "./workflow.css";

// CodeMirror and the YAML form are only needed once the user starts editing.
const MarkdownEditor = lazy(() => import("../shared/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));
const WorkflowForm = lazy(() => import("./WorkflowForm").then((m) => ({ default: m.WorkflowForm })));

const WORKFLOW_FILE = "workflow.yml";
const PROMPT_FILE = /^[a-z0-9][a-z0-9-]*\.md$/;
const draftKey = (name: string) => `workflow:${name}`;
const DRAFT_PREFIX = "workflow:";
/** Starting text of a new prompt file; prompts are written in English like the built-in ones. */
const NEW_PROMPT = 'Task {{key}}: "{{title}}". The requirements are in {{specDir}}/.\n\nWrite:\n{{outputs}}\n\nRules:\n{{rules}}\n';

/**
 * The task workflow: TaskPilot's built-in one is shown read only; "Thêm config override" copies it
 * into the repo's .claude/taskpilot/, where every file can then be edited, checked and previewed.
 */
export function WorkflowPage() {
  const { t } = useTranslation("config");
  const { data, error, loading, reload } = useConfig(["workflow"], workflowConfigApi.get);
  const dirty = useDrafts();
  const [picked, setPicked] = useState(WORKFLOW_FILE);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [adding, setAdding] = useState(false);

  const isOverride = data?.origin === "repo";
  const draftNames = isOverride ? openDraftNames(dirty, picked) : [];
  const draft = getDraft<WorkflowDraft>(draftKey(picked));
  const file = data?.files.find((f) => f.name === picked);
  const newFiles = draftNames.filter((n) => !data?.files.some((f) => f.name === n));

  // Task stages are read from the workflow's documents, so the task list follows every change.
  const refresh = async () => {
    await reload();
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  useEffect(() => setConfirm(null), [picked]);
  // A new prompt whose draft was cancelled no longer exists: go back to workflow.yml.
  useEffect(() => {
    if (data && !draft && !file) setPicked(WORKFLOW_FILE);
  }, [data, draft, file]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const createOverride = () =>
    run(async () => {
      const res = await workflowConfigApi.createOverride();
      toast(t("workflow.created", { count: res.files.length }));
      await refresh();
    });

  const reset = () =>
    run(async () => {
      await workflowConfigApi.reset(Object.fromEntries((data?.files ?? []).map((f) => [f.name, f.hash])));
      for (const f of data?.files ?? []) clearDraft(draftKey(f.name));
      toast(t("workflow.resetDone"));
      setPicked(WORKFLOW_FILE);
      await refresh();
    });

  const removeFile = () =>
    run(async () => {
      await workflowConfigApi.remove(picked, file!.hash);
      toast(t("deletedRestorable", { name: file!.path }));
      setPicked(WORKFLOW_FILE);
      await refresh();
    });

  const startEdit = () =>
    run(async () => {
      const raw = await workflowConfigApi.file(picked);
      setDraft(draftKey(picked), { name: picked, path: raw.path, content: raw.content, baseHash: raw.hash, isNew: false } satisfies WorkflowDraft);
    });

  const flow = useSaveFlow({
    title: t(draft?.isNew ? "library.createTitle" : "library.saveTitle", { path: draft?.path ?? "" }),
    preview: () => workflowConfigApi.preview(draft!.name, draft!.content, draft!.baseHash),
    save: () => workflowConfigApi.save(draft!.name, draft!.content, draft!.baseHash),
    onSaved: () => {
      toast(t(draft!.isNew ? "library.created" : "library.saved", { path: draft!.path }));
      clearDraft(draftKey(draft!.name));
      void refresh();
    },
  });

  const actions = !data ? null : !isOverride ? (
    <Button icon={Plus} variant="primary" busy={busy} title={t("workflow.createTitle", { dir: data.overrideDir })} onClick={() => void createOverride()}>
      {t("workflow.create")}
    </Button>
  ) : draft ? (
    <>
      <DraftControls key={picked} draftKey={draftKey(picked)} />
      <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
        {t("action.review")}
      </Button>
    </>
  ) : (
    <>
      <Button icon={FilePlus} variant="quiet" onClick={() => setAdding((a) => !a)}>
        {t("workflow.addPrompt")}
      </Button>
      {confirm === "reset" ? (
        <Button icon={ArrowCounterClockwise} variant="danger" busy={busy} onClick={() => void reset()}>
          {t("workflow.resetConfirm")}
        </Button>
      ) : (
        <Button icon={ArrowCounterClockwise} variant="quiet" title={t("workflow.resetTitle", { dir: data.overrideDir })} onClick={() => setConfirm("reset")}>
          {t("workflow.reset")}
        </Button>
      )}
      {file && (
        <Button icon={PencilSimple} variant="primary" busy={busy} title={t("library.editTitle", { path: file.path })} onClick={() => void startEdit()}>
          {t("action.edit")}
        </Button>
      )}
    </>
  );

  return (
    <div className="page">
      <ConfigHeader title={t("workflow.title")} subtitle={t("workflow.subtitle")} />
      <ConfigToolbar
        start={data && <OriginBadge config={data} />}
        readOnly={!!data && !isOverride}
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      {data && (
        <div className="page-body wf-page">
          {!isOverride && (
            <section className="card wf-intro">
              <h2 className="card-title">{t("workflow.defaultTitle")}</h2>
              <p>{t("workflow.defaultBody", { dir: data.overrideDir })}</p>
              <ul className="file-list">
                {data.files.map((f) => (
                  <li key={f.name} className="mono">
                    {data.overrideDir}/{f.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {isOverride && confirm === "reset" && <p className="alert-warn">{t("workflow.resetHint", { dir: data.overrideDir })}</p>}
          <p className="hint">{t("workflow.runNote")}</p>
          <Checks config={data} draft={draft} />

          <div className="library">
            <FileNav
              config={data}
              picked={picked}
              newFiles={newFiles}
              onPick={setPicked}
              adding={adding && isOverride}
              onAdd={(name) => {
                setDraft(draftKey(name), { name, path: `${data.overrideDir}/${name}`, content: NEW_PROMPT, baseHash: "absent", isNew: true } satisfies WorkflowDraft, null);
                setPicked(name);
                setAdding(false);
              }}
            />
            <div className="wf-main">
              {draft ? (
                <FileEditor draft={draft} config={data} />
              ) : file ? (
                <FileView
                  file={file}
                  editable={isOverride}
                  confirmDelete={confirm === "delete"}
                  busy={busy}
                  onDelete={() => (confirm === "delete" ? void removeFile() : setConfirm("delete"))}
                />
              ) : null}
              <PromptPreview config={data} />
            </div>
          </div>
        </div>
      )}
      {draft && <DiffDialog {...flow.dialog} confirmLabel={draft.isNew ? t("library.createFile") : t("library.saveFile")} />}
    </div>
  );
}

/** Override files with an open draft (the picked one always counts, so its tab stays while it is open). */
function openDraftNames(dirty: string[], picked: string): string[] {
  const names = new Set(dirty.filter((k) => k.startsWith(DRAFT_PREFIX)).map((k) => k.slice(DRAFT_PREFIX.length)));
  if (getDraft(draftKey(picked))) names.add(picked);
  return [...names];
}

function OriginBadge({ config }: { config: WorkflowConfig }) {
  const { t } = useTranslation("config");
  return (
    <span className={`wf-origin wf-origin-${config.origin}`} title={config.dir}>
      {config.origin === "repo" ? t("workflow.originRepo", { dir: config.overrideDir }) : t("workflow.originDefault")}
    </span>
  );
}

/** Errors and warnings of the workflow; while a file is being edited, of the workflow with that draft in it. */
function Checks({ config, draft }: { config: WorkflowConfig; draft: WorkflowDraft | undefined }) {
  const { t } = useTranslation("config");
  const [live, setLive] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const content = draft?.content;
  const name = draft?.name;

  useEffect(() => {
    if (name === undefined || content === undefined) return setLive(null);
    const timer = setTimeout(() => {
      workflowConfigApi.validate(name, content).then(setLive, (e: Error) => setLive({ errors: [e.message], warnings: [] }));
    }, 400);
    return () => clearTimeout(timer);
  }, [name, content]);

  const { errors, warnings } = live ?? config;
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <p className="wf-ok">
        <CheckCircle weight="fill" aria-hidden="true" />
        {t("workflow.valid")}
      </p>
    );
  }
  return (
    <ul className="checks wf-checks-list" aria-label={t("workflow.checks")}>
      {errors.map((e) => (
        <li key={`e-${e}`} className="check-error">
          <Warning weight="fill" aria-hidden="true" />
          <span>{e}</span>
        </li>
      ))}
      {warnings.map((w) => (
        <li key={`w-${w}`} className="check-warn">
          <Warning weight="fill" aria-hidden="true" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

function FileNav(props: {
  config: WorkflowConfig;
  picked: string;
  newFiles: string[];
  adding: boolean;
  onPick: (name: string) => void;
  onAdd: (name: string) => void;
}) {
  const { t } = useTranslation("config");
  const { config } = props;
  const steps = config.def?.steps ?? [];
  const known = new Set([WORKFLOW_FILE, ...steps.flatMap((s) => [s.promptFile, s.onRejectFile ?? ""])]);
  const loose = [...config.files.map((f) => f.name).filter((n) => !known.has(n)), ...props.newFiles];

  const item = (name: string, label?: string) => {
    const file = config.files.find((f) => f.name === name);
    return (
      <li key={`${label ?? ""}${name}`}>
        <button type="button" className="lib-item wf-item" aria-current={props.picked === name} onClick={() => props.onPick(name)}>
          <span className="lib-name mono">{name}</span>
          {isDirty(draftKey(name)) ? (
            <span className="unsaved-pill">{t("draft.unsaved")}</span>
          ) : (
            config.origin === "repo" &&
            file?.sameAsDefault !== undefined && (
              <span className={`wf-tag${file.sameAsDefault ? "" : " is-changed"}`}>
                {file.sameAsDefault === null ? t("workflow.tag.new") : file.sameAsDefault ? t("workflow.tag.same") : t("workflow.tag.changed")}
              </span>
            )
          )}
          {label && <span className="lib-desc">{label}</span>}
        </button>
      </li>
    );
  };

  return (
    <nav className="library-list wf-nav" aria-label={t("workflow.files")}>
      <ul>{item(WORKFLOW_FILE, t("workflow.ymlLabel"))}</ul>
      {steps.map((s, i) => (
        <div key={s.id} className="wf-nav-step">
          <div className="pane-label">
            {t("workflow.form.step", { n: i + 1 })} · {s.title}
          </div>
          <p className="wf-step-meta">
            {t(`workflow.gate.${s.gate}`)}
            {s.outputs.length > 0 && <> · {s.outputs.map((o) => (o.id === s.doneWhen ? `${o.file} ✓` : o.file)).join(", ")}</>}
          </p>
          <ul>
            {item(s.promptFile, t("workflow.promptLabel"))}
            {s.onRejectFile && item(s.onRejectFile, t("workflow.onRejectLabel"))}
          </ul>
        </div>
      ))}
      {loose.length > 0 && (
        <div className="wf-nav-step">
          <div className="pane-label">{t("workflow.otherFiles")}</div>
          <ul>{loose.map((n) => item(n))}</ul>
        </div>
      )}
      {props.adding && <NewPromptForm existing={[...config.files.map((f) => f.name), ...props.newFiles]} onAdd={props.onAdd} />}
    </nav>
  );
}

function NewPromptForm({ existing, onAdd }: { existing: string[]; onAdd: (name: string) => void }) {
  const { t } = useTranslation("config");
  const [name, setName] = useState("");
  const file = name.endsWith(".md") ? name : `${name}.md`;
  const error = !name ? null : !PROMPT_FILE.test(file) ? t("workflow.promptNameHelp") : existing.includes(file) ? t("library.exists", { path: file }) : null;
  return (
    <form
      className="wf-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (name && !error) onAdd(file);
      }}
    >
      <label className="pane-label" htmlFor="wf-new-name">
        {t("workflow.addPrompt")}
      </label>
      <div className="wf-row">
        <input id="wf-new-name" className="mono" value={name} placeholder="review.md" autoFocus spellCheck={false} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon={Plus} disabled={!name || !!error}>
          {t("action.add")}
        </Button>
      </div>
      <span className={error ? "error" : "field-help"}>{error ?? t("workflow.promptNameHelp")}</span>
    </form>
  );
}

function FileView(props: { file: WorkflowFile; editable: boolean; confirmDelete: boolean; busy: boolean; onDelete: () => void }) {
  const { t } = useTranslation("config");
  const { file } = props;
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => setDiff(null), [file.name, file.hash]);

  const lines = (diff ?? "").split("\n").filter((l) => !/^(={3,}|-{3} |\+{3} |Index: |\\ No newline)/.test(l));
  return (
    <section className="code-view wf-file" aria-label={t("library.contentLabel", { path: file.path })}>
      <div className="code-head">
        <span className="mono">{file.path}</span>
        <span className="code-meta">
          {file.usedBy.length > 0 ? t("workflow.usedBy", { steps: file.usedBy.join(", ") }) : file.name === WORKFLOW_FILE ? "" : t("workflow.unused")}
        </span>
        {props.editable && file.sameAsDefault === false && (
          <Button
            icon={GitDiff}
            variant="quiet"
            onClick={() =>
              diff === null
                ? void workflowConfigApi.defaultDiff(file.name).then((r) => setDiff(r.diff), (e: Error) => toast(e.message, { error: true }))
                : setDiff(null)
            }
          >
            {diff === null ? t("workflow.compare") : t("workflow.hideCompare")}
          </Button>
        )}
        {props.editable && file.name !== WORKFLOW_FILE && file.usedBy.length === 0 && (
          <Button icon={Trash} variant={props.confirmDelete ? "danger" : "quiet"} busy={props.busy} onClick={props.onDelete}>
            {props.confirmDelete ? t("action.deleteConfirm") : t("action.delete")}
          </Button>
        )}
      </div>
      {diff !== null ? (
        <pre className="diff-view" aria-label={t("workflow.compare")}>
          {lines.map((l, i) => (
            <span key={i} className={l.startsWith("+") ? "is-add" : l.startsWith("-") ? "is-del" : l.startsWith("@@") ? "is-hunk" : undefined}>
              {l || " "}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        <ol className="code-lines">
          {file.content.split("\n").map((text, i) => (
            <li key={i}>
              <span className="ln" aria-hidden="true">
                {i + 1}
              </span>
              <span className="lt">{highlightVars(text)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** {{variables}} stand out in prompt text. */
function highlightVars(text: string) {
  if (!text) return " ";
  return text.split(/(\{\{[\w.]+\}\})/g).map((part, i) =>
    /^\{\{[\w.]+\}\}$/.test(part) ? (
      <span key={i} className="wf-var">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function FileEditor({ draft, config }: { draft: WorkflowDraft; config: WorkflowConfig }) {
  const { t } = useTranslation("config");
  const [tab, setTab] = useState<"form" | "yaml">("form");
  const insert = useRef<((text: string) => void) | null>(null);
  const update = (content: string) => setDraft(draftKey(draft.name), { ...draft, content });
  const isYml = draft.name === WORKFLOW_FILE;
  const prompts = config.files.map((f) => f.name).filter((n) => n !== WORKFLOW_FILE);
  const outputIds = (config.def?.steps ?? []).flatMap((s) => s.outputs.map((o) => o.id));

  return (
    <section className="card lib-editor wf-editor" aria-label={t("library.editLabel", { path: draft.path })}>
      <header className="lib-head">
        <h2 className="mono">{draft.path}</h2>
        {isYml && (
          <div className="segmented" role="tablist" aria-label={t("workflow.editorTabs")}>
            <button type="button" role="tab" aria-selected={tab === "form"} onClick={() => setTab("form")}>
              {t("workflow.tabForm")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "yaml"} onClick={() => setTab("yaml")}>
              {t("workflow.tabYaml")}
            </button>
          </div>
        )}
      </header>
      {!isYml && (
        <div className="wf-chips" aria-label={t("workflow.variables")}>
          <span className="pane-label">{t("workflow.variables")}</span>
          {[...config.variables, ...outputIds.map((id) => `out.${id}`)].map((v) => (
            <button key={v} type="button" className="wf-chip mono" title={t(`workflow.var.${v.startsWith("out.") ? "out" : v}` as "workflow.var.key")} onClick={() => insert.current?.(`{{${v}}}`)}>
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      )}
      <Suspense fallback={<p className="hint">{t("library.editorLoading")}</p>}>
        {isYml && tab === "form" ? (
          <WorkflowForm text={draft.content} prompts={prompts} onChange={update} />
        ) : (
          <MarkdownEditor key={`${draft.name}-${tab}`} value={draft.content} label={t("library.contentLabel", { path: draft.path })} insertRef={insert} onChange={update} />
        )}
      </Suspense>
    </section>
  );
}

/** The prompt a step would send for a task, rendered by the server from the workflow plus open drafts. */
function PromptPreview({ config }: { config: WorkflowConfig }) {
  const { t } = useTranslation("config");
  const { tasks } = useWorkspace();
  const steps = config.def?.steps ?? [];
  const [taskKey, setTaskKey] = useState("");
  const [stepId, setStepId] = useState("");
  const [kind, setKind] = useState<"prompt" | "onReject">("prompt");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDrafts();

  const task = taskKey || tasks[0]?.key || "";
  const step = steps.find((s) => s.id === stepId) ?? steps[0];

  const show = async () => {
    setError(null);
    const drafts: Record<string, string> = {};
    if (config.origin === "repo") {
      for (const name of [...config.files.map((x) => x.name), ...openDraftNames(dirty, "")]) {
        const d = getDraft<WorkflowDraft>(draftKey(name));
        if (d) drafts[name] = d.content;
      }
    }
    try {
      setText((await workflowConfigApi.render({ taskKey: task, stepId: step!.id, kind, drafts })).text);
    } catch (e) {
      setText(null);
      setError((e as Error).message);
    }
  };

  if (!step) return null;
  return (
    <section className="card wf-preview" aria-label={t("workflow.preview.title")}>
      <h2 className="card-title">{t("workflow.preview.title")}</h2>
      <p className="field-help">{t("workflow.preview.help")}</p>
      {tasks.length === 0 ? (
        <p className="hint">{t("workflow.preview.noTasks")}</p>
      ) : (
        <div className="wf-preview-controls">
          <select aria-label={t("workflow.preview.task")} value={task} onChange={(e) => setTaskKey(e.target.value)}>
            {tasks.map((x) => (
              <option key={x.key} value={x.key}>
                {x.key} · {x.title}
              </option>
            ))}
          </select>
          <select aria-label={t("workflow.preview.step")} value={step.id} onChange={(e) => setStepId(e.target.value)}>
            {steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <select aria-label={t("workflow.preview.kind")} value={kind} onChange={(e) => setKind(e.target.value as "prompt" | "onReject")}>
            <option value="prompt">{t("workflow.promptLabel")}</option>
            {step.onRejectFile && <option value="onReject">{t("workflow.onRejectLabel")}</option>}
          </select>
          <Button icon={Play} onClick={() => void show()}>
            {t("workflow.preview.show")}
          </Button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {text !== null && <pre className="wf-rendered">{text}</pre>}
    </section>
  );
}
