import type { WorkflowConfigView } from "@server/api-types";
import { ArrowsLeftRight, CheckCircle, FilePlus, FloppyDisk, Trash, Warning, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { DiffView } from "@/components/diff-view";
import { Markdown } from "@/components/markdown";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { settingsApi } from "@/features/workflow/run-options";
import { useRepo } from "@/features/workspace/queries";
import { PROVIDER_LABELS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { PromptPreview } from "./prompt-preview";
import { refreshWorkflow, useWorkflowConfig, WORKFLOW_FILE, workflowConfigApi } from "./queries";

type WorkflowFile = WorkflowConfigView["files"][number];
export interface WorkflowSearch {
  file?: string;
  mode?: string;
  view?: "ui" | "raw";
}

const isFormat = (name: string) => name.startsWith("format-");

/**
 * The task workflow: TaskPilot's modes are shown read only; an override in .taskpilot/ makes the
 * mode's files editable as raw files. `formats` lists only the document format files.
 */
export function WorkflowPage({ section, search }: { section: "workflow" | "formats"; search: WorkflowSearch }) {
  const { t } = useTranslation("config");
  const navigate = useNavigate();
  const config = useWorkflowConfig(search.mode);
  const data = config.data;
  const go = (next: Partial<WorkflowSearch>, to: "workflow" | "formats" = section) => void navigate({ to: "/config/$section", params: { section: to }, search: { ...search, ...next } });
  const files = (data?.files ?? [])
    .filter((f) => (section === "formats" ? isFormat(f.name) : !isFormat(f.name)))
    .sort((a, b) => Number(b.name === WORKFLOW_FILE) - Number(a.name === WORKFLOW_FILE));
  const [added, setAdded] = useState<string[]>([]);
  const names = [...files.map((f) => f.name), ...added.filter((n) => !files.some((f) => f.name === n))];
  const picked = search.file && names.includes(search.file) ? search.file : names[0];
  const file = files.find((f) => f.name === picked);
  const editable = data?.origin === "repo";
  const view = search.view ?? "ui";

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={t("workflow.title")} />
      <Tabs value={section} onValueChange={(next) => go({ file: undefined }, next as "workflow" | "formats")} className="border-b border-line px-4 py-2 sm:px-6">
        <TabsList>
          <TabsTrigger value="workflow">{t("workflow.title")}</TabsTrigger>
          <TabsTrigger value="formats">{t("workflow.formats")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {config.error ? (
        <EmptyState title={config.error.message} />
      ) : !data ? (
        <p className="p-6 text-sm text-muted">{t("loading")}</p>
      ) : (
        <div className="grid gap-4 px-4 py-4 sm:px-6">
          <ModeBar data={data} onMode={(mode) => go({ mode, file: undefined })} />
          <Checks data={data} />
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <nav aria-label={t("workflow.files")} className="grid content-start gap-1">
              {names.map((name) => {
                const f = files.find((x) => x.name === name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => go({ file: name })}
                    aria-current={name === picked ? "page" : undefined}
                    className={cn("grid gap-0.5 rounded-sm px-2.5 py-2 text-left hover:bg-hover", name === picked && "bg-signal-soft")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{name}</span>
                      {f && editable && f.sameAsDefault === false && <Badge tone="signal">{f.provenance === "added" ? t("workflow.added") : t("workflow.changed")}</Badge>}
                    </span>
                    {f && f.usedBy.length > 0 && <span className="truncate text-xs text-faint">{t("workflow.usedBy", { list: f.usedBy.join(", ") })}</span>}
                  </button>
                );
              })}
              {editable && section === "workflow" && <NewFile onCreate={(name) => (setAdded((list) => [...list, name]), go({ file: name, view: "raw" }))} />}
            </nav>
            <div className="grid min-w-0 content-start gap-3">
              {picked && (
                <Tabs value={view} onValueChange={(next) => go({ view: next as "ui" | "raw" })}>
                  <TabsList aria-label={t("view.label")}>
                    <TabsTrigger value="ui">{t("view.ui")}</TabsTrigger>
                    <TabsTrigger value="raw">{t("view.raw")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              {picked &&
                (view === "ui" ? (
                  picked === WORKFLOW_FILE ? (
                    <Definition data={data} />
                  ) : (
                    <div className="rounded-md border border-line bg-surface px-5 py-4">
                      <Markdown source={file?.content ?? data.newPrompt} />
                    </div>
                  )
                ) : editable ? (
                  <OverrideFileEditor key={`${picked}:${file?.hash ?? "new"}`} name={picked} file={file} template={data.newPrompt} onRemoved={() => go({ file: undefined, view: "ui" })} />
                ) : (
                  <ReadOnlyFile file={file} />
                ))}
              {section === "workflow" && <PromptPreview data={data} mode={search.mode} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeBar({ data, onMode }: { data: WorkflowConfigView; onMode: (mode: string) => void }) {
  const { t } = useTranslation(["config", "common"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [migration, setMigration] = useState<Awaited<ReturnType<typeof workflowConfigApi.migrate>> | null>(null);
  const hashes = Object.fromEntries(data.files.map((f) => [f.name, f.hash]));
  const act = async (name: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    try {
      await action();
      if (done) toast.success(done);
      await refreshWorkflow();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const repo = useRepo().data?.path;
  const modes = useQuery({ queryKey: ["workflow-modes", repo], queryFn: settingsApi.modes, enabled: Boolean(repo) });
  const legacy = data.overrideKind === "legacy" && data.mode.id === "custom";

  return (
    <div className="grid gap-3 rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t("workflow.mode")}</span>
        <Select value={data.mode.id} onValueChange={onMode}>
          <SelectTrigger className="w-auto min-w-40" aria-label={t("workflow.mode")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.modes.map((mode) => (
              <SelectItem key={mode.id} value={mode.id}>
                {mode.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge tone={data.origin === "repo" ? "signal" : "neutral"}>{data.origin === "repo" ? t("workflow.origin.repo", { dir: data.overrideDir }) : t("workflow.origin.default")}</Badge>
        {data.mode.id === data.selected ? (
          <Badge tone="done">
            <CheckCircle weight="fill" aria-hidden />
            {t("workflow.selected")}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            busy={busy === "mode"}
            disabled={!modes.data}
            onClick={() => void act("mode", () => workflowConfigApi.setMode(data.mode.id, modes.data!.hash), t("workflow.madeDefault", { name: data.mode.name }))}
          >
            {t("workflow.makeDefault")}
          </Button>
        )}
        <span className="ml-auto" />
        {data.origin === "default" && data.overrideKind === "none" && (
          <Button
            size="sm"
            variant="primary"
            busy={busy === "create"}
            onClick={() => void act("create", () => workflowConfigApi.createOverride(data.mode.id), t("workflow.created", { count: 1 }))}
          >
            <FilePlus aria-hidden />
            {t("workflow.createOverride")}
          </Button>
        )}
        {data.origin === "repo" && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
            <Trash aria-hidden />
            {t("workflow.reset")}
          </Button>
        )}
        {legacy && (
          <Button size="sm" busy={busy === "migrate"} onClick={() => void act("migrate", async () => setMigration(await workflowConfigApi.migrate({})))}>
            <ArrowsLeftRight aria-hidden />
            {t("workflow.migrate")}
          </Button>
        )}
      </div>
      {data.origin === "default" && data.overrideKind === "none" && <p className="text-xs text-muted">{t("workflow.createHint", { dir: data.overrideDir })}</p>}
      {data.origin === "default" && data.overrideKind !== "none" && <p className="text-xs text-attention">{t("workflow.otherOverride", { base: data.overrideExtends ?? "custom" })}</p>}

      <Dialog open={confirmReset} onOpenChange={(open) => busy === null && setConfirmReset(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workflow.reset")}</DialogTitle>
            <DialogDescription>{t("workflow.resetConfirm", { dir: data.overrideDir })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="danger"
              busy={busy === "reset"}
              onClick={() => void act("reset", () => workflowConfigApi.reset(hashes), t("workflow.resetDone")).then(() => setConfirmReset(false))}
            >
              <Trash aria-hidden />
              {t("workflow.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={migration !== null} onOpenChange={(open) => !open && busy === null && setMigration(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("workflow.migrate")}</DialogTitle>
            <DialogDescription>{t("workflow.migrateHint")}</DialogDescription>
          </DialogHeader>
          {migration?.errors.map((error) => (
            <p key={error} role="alert" className="text-sm text-danger">
              {error}
            </p>
          ))}
          {migration && <DiffView diff={migration.diff} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMigration(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="primary"
              busy={busy === "apply"}
              disabled={!migration || migration.errors.length > 0}
              onClick={() => void act("apply", () => workflowConfigApi.migrate({ apply: true, hashes }), t("workflow.migrateDone")).then(() => setMigration(null))}
            >
              {t("workflow.migrateApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Checks({ data }: { data: WorkflowConfigView }) {
  const { t } = useTranslation("config");
  if (!data.errors.length && !data.warnings.length) return null;
  return (
    <div className="grid gap-2">
      {data.errors.length > 0 && <List tone="danger" title={t("workflow.errors")} icon={<WarningCircle weight="fill" aria-hidden />} items={data.errors} />}
      {data.warnings.length > 0 && <List tone="attention" title={t("workflow.warnings")} icon={<Warning weight="fill" aria-hidden />} items={data.warnings} />}
    </div>
  );
}

function List({ tone, title, icon, items }: { tone: "danger" | "attention"; title: string; icon: ReactNode; items: string[] }) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("grid gap-1 rounded-sm border p-3 text-sm", tone === "danger" ? "border-danger/40 bg-danger-soft text-danger" : "border-attention-line bg-attention-soft text-attention")}
    >
      <p className="flex items-center gap-1.5 font-medium [&_svg]:size-4">
        {icon}
        {title}
      </p>
      <ul className="list-disc pl-6">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** workflow.yml as steps: agent, gate, documents and prompts, plus the workflow-wide settings. */
function Definition({ data }: { data: WorkflowConfigView }) {
  const { t } = useTranslation("config");
  const def = data.def;
  if (!def) return null;
  return (
    <div className="grid gap-3">
      <dl className="grid gap-2 rounded-md border border-line bg-surface p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-faint">{t("workflow.settings.history")}</dt>
          <dd className="font-mono text-xs">{def.history.file}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">{t("workflow.settings.language")}</dt>
          <dd>{def.language}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">{t("workflow.settings.permission")}</dt>
          <dd className="font-mono text-xs">{def.permissionMode ?? "default"}</dd>
        </div>
        {def.rules.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-faint">{t("workflow.settings.rules")}</dt>
            <dd>
              <ul className="list-disc pl-5">
                {def.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      <h2 className="text-sm font-semibold">{t("workflow.steps")}</h2>
      <ol className="grid gap-2">
        {def.steps.map((step, i) => (
          <li key={step.id} className="grid gap-1.5 rounded-md border border-line bg-surface p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-faint">{i + 1}.</span>
              <span className="font-medium">{step.title}</span>
              <code className="text-xs">{step.id}</code>
              <Badge>{PROVIDER_LABELS[step.agent]}</Badge>
              <Badge tone={step.gate === "approve" ? "attention" : "neutral"}>{step.gate === "approve" ? t("workflow.gateApprove") : t("workflow.gateNone")}</Badge>
            </p>
            {step.dispatch && <p className="text-xs text-muted">{t("workflow.step.dispatch", { parallel: step.dispatch.parallel })}</p>}
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>
                {t("workflow.step.prompt")}: <code>{step.dispatch?.promptFile ?? step.promptFile}</code>
              </span>
              {step.outputs.length > 0 && (
                <span>
                  {t("workflow.step.outputs")}:{" "}
                  {step.outputs.map((o) => (
                    <code key={o.id}>{o.file}</code>
                  ))}
                </span>
              )}
              {step.doneWhen && (
                <span>
                  {t("workflow.step.done")}: <code>{step.doneWhen}</code>
                </span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReadOnlyFile({ file }: { file: WorkflowFile | undefined }) {
  const { t } = useTranslation("config");
  if (!file) return null;
  return (
    <div className="grid gap-2">
      <p className="flex items-center gap-2 text-xs text-muted">
        <code className="bg-transparent px-0">{file.path}</code> · {t("workflow.readOnlyHint")}
      </p>
      <div className="h-[60vh] min-h-72 overflow-hidden rounded-sm border border-line">
        <CodeEditor value={file.content} format={file.name.endsWith(".yml") ? "yaml" : "markdown"} readOnly label={file.path} />
      </div>
    </div>
  );
}

/** A file of the repo's override: edit, compare with the mode's, preview the diff (the server re-checks the workflow), save or delete. */
function OverrideFileEditor({ name, file, template, onRemoved }: { name: string; file: WorkflowFile | undefined; template: string; onRemoved: () => void }) {
  const { t } = useTranslation(["config", "common"]);
  const [draft, setDraft] = useState<string | null>(file ? null : template);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof workflowConfigApi.preview>> | null>(null);
  const [compare, setCompare] = useState<{ diff: string; same: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const content = draft ?? file?.content ?? "";
  const hash = file?.hash ?? "absent";
  const dirty = draft !== null && draft !== file?.content;
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate bg-transparent px-0 text-sm">{file?.path ?? name}</code>
        {file?.sameAsDefault !== null && file && (
          <Button size="sm" variant="ghost" busy={busy === "compare"} onClick={() => void run("compare", async () => setCompare(await workflowConfigApi.defaultDiff(name)))}>
            <ArrowsLeftRight aria-hidden />
            {t("workflow.compare")}
          </Button>
        )}
        {file && name !== WORKFLOW_FILE && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash aria-hidden />
            {t("workflow.deleteFile")}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(file ? null : template)}>
          {t("raw.revert")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          busy={busy === "preview"}
          disabled={!dirty && Boolean(file)}
          onClick={() => void run("preview", async () => setPreview(await workflowConfigApi.preview(name, content, hash)))}
        >
          <FloppyDisk aria-hidden />
          {t("raw.save")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger-soft p-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="h-[60vh] min-h-72 overflow-hidden rounded-sm border border-line">
        <CodeEditor value={content} onChange={setDraft} format={name.endsWith(".yml") ? "yaml" : "markdown"} label={name} />
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && busy === null && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("raw.previewTitle", { file: file?.path ?? name })}</DialogTitle>
            <DialogDescription>{t("raw.previewHint")}</DialogDescription>
          </DialogHeader>
          {preview?.stale && (
            <p role="alert" className="text-sm text-danger">
              {t("raw.stale")}
            </p>
          )}
          {preview?.warnings.map((w) => (
            <p key={w} className="text-sm text-attention">
              {w}
            </p>
          ))}
          {preview && (preview.changed ? <DiffView diff={preview.diff} /> : <p className="text-sm text-muted">{t("raw.unchanged")}</p>)}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="primary"
              busy={busy === "save"}
              disabled={!preview?.changed || preview.stale}
              onClick={() =>
                void run("save", async () => {
                  await workflowConfigApi.save(name, content, hash);
                  toast.success(t("raw.saved", { file: name }));
                  setPreview(null);
                  setDraft(null);
                  await refreshWorkflow();
                })
              }
            >
              <FloppyDisk aria-hidden />
              {t("raw.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={compare !== null} onOpenChange={(open) => !open && setCompare(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("workflow.compareTitle", { file: name })}</DialogTitle>
          </DialogHeader>
          {compare && (compare.same ? <p className="text-sm text-muted">{t("workflow.same")}</p> : <DiffView diff={compare.diff} />)}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={(open) => busy === null && setConfirmDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workflow.deleteFile")}</DialogTitle>
            <DialogDescription>{t("workflow.deleteConfirm", { file: name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="danger"
              busy={busy === "delete"}
              onClick={() =>
                void run("delete", async () => {
                  await workflowConfigApi.remove(name, hash);
                  toast.success(t("raw.deleted", { file: name }));
                  setConfirmDelete(false);
                  await refreshWorkflow();
                  onRemoved();
                })
              }
            >
              <Trash aria-hidden />
              {t("workflow.deleteFile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewFile({ onCreate }: { onCreate: (name: string) => void }) {
  const { t } = useTranslation("config");
  const [name, setName] = useState("");
  const valid = /^[A-Za-z0-9][\w.-]*\.md$/.test(name);
  return (
    <form
      className="mt-2 grid gap-1.5 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) {
          onCreate(name);
          setName("");
        }
      }}
    >
      <span className="text-xs font-medium text-faint">{t("workflow.newFile")}</span>
      <div className="flex gap-1.5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("workflow.newFileName")} aria-label={t("workflow.newFileName")} spellCheck={false} className="h-8" />
        <Button type="submit" size="sm" disabled={!valid}>
          {t("workflow.create")}
        </Button>
      </div>
    </form>
  );
}
