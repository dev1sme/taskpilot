import { Eye, MagnifyingGlass, PencilSimple, Plus, Robot, Trash, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "../../workspace";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import i18n from "../../../i18n";
import { Markdown } from "../../../shared/ui/Markdown";
import { toast } from "../../../shared/ui/Toast";
import { clearDraft, getDraft, setDraft, useDrafts } from "../shared/drafts";
import { backupToast, ConfigHeader, ConfigToolbar, DraftControls, EmptyCard, LoadError, PageTabs, ScopeTabs, ScopeTag } from "../shared/parts";
import { shadowedBy } from "../shared/precedence";
import { useConfig } from "../shared/useConfig";
import { useSaveFlow } from "../shared/useSaveFlow";
import "../../../shared/ui/dialog.css";
import { CheckPill, CheckSection, NoAgentsBanner, TemplatesDialog } from "./AgentTemplates";
import { libraryApi } from "./api";
import type { LibraryItem, LibraryKind } from "./types";
import "../shared/library-view.css";
import "../../../shared/ui/icon-button.css";

const MarkdownEditor = lazy(() => import("../shared/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

/** Shown before an item's name: commands run as `/name`. */
const PREFIX: Record<LibraryKind, string> = { agents: "", commands: "/", skills: "" };

/** Texts of `kind` from `config:library.kind.<kind>`. */
function useCopy(kind: LibraryKind) {
  const { t } = useTranslation("config");
  return {
    title: t(`library.kind.${kind}.title`),
    one: t(`library.kind.${kind}.one`),
    subtitle: t(`library.kind.${kind}.subtitle`),
    empty: t(`library.kind.${kind}.empty`),
    prefix: PREFIX[kind],
  };
}

type LibraryScope = LibraryItem["scope"];
const LIBRARY_SCOPES: readonly LibraryScope[] = ["project", "user"];

/** Folder of `kind` in `scope`, as the tab and the new-item dialog show it. */
const scopeDir = (kind: LibraryKind, scope: LibraryScope) => (scope === "project" ? `.claude/${kind}` : `~/.claude/${kind}`);

/** Starting content for a new item; the user edits it before the first save. Placeholders follow the UI language. */
function template(kind: LibraryKind, name: string): string {
  const base = name.split("/").pop() ?? name;
  const t = i18n.getFixedT(null, "config", "library.template");
  if (kind === "agents") {
    return `---\nname: ${base}\ndescription: ${t("agentDescription")}\ntools: Read, Grep, Glob\nmodel: sonnet\n---\n\n${t("agentBody", { name: base })}\n`;
  }
  if (kind === "commands") return `---\ndescription: ${t("commandDescription")}\nargument-hint: ${t("commandArgumentHint")}\n---\n\n${t("commandBody")}\n`;
  return `---\nname: ${base}\ndescription: ${t("skillDescription")}\n---\n\n# ${base}\n\n${t("skillBody")}\n`;
}

function relFor(kind: LibraryKind, name: string): string {
  return kind === "skills" ? `${name}/SKILL.md` : `${name}.md`;
}

interface LibraryDraft {
  kind: LibraryKind;
  scope: LibraryScope;
  rel: string;
  path: string;
  content: string;
  baseHash: string;
  isNew: boolean;
}

const draftKey = (kind: LibraryKind) => `library:${kind}`;

const KINDS: readonly LibraryKind[] = ["agents", "commands", "skills"];

/** Switches between the three library sections; each tab is the section's own route. */
function KindTabs({ kind }: { kind: LibraryKind }) {
  const { t } = useTranslation("config");
  const tabs = KINDS.map((k) => ({ route: { page: "config", section: k } as const, label: t(`library.kind.${k}.title`), current: k === kind }));
  return <PageTabs label={t("library.tabsLabel")} tabs={tabs} />;
}

/** Agents, commands or skills: list + detail, with create, edit (diff review) and delete (backed up). */
export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const { t } = useTranslation("config");
  const { data, error, loading, reload } = useConfig(["library", kind], () => libraryApi.library(kind));
  const { reloadInventory } = useWorkspace();
  const [scope, setScope] = useState<LibraryScope>("project");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  useDrafts();
  const draft = getDraft<LibraryDraft>(draftKey(kind));
  const copy = useCopy(kind);

  const inScope = useMemo(() => (data ?? []).filter((i) => i.scope === scope), [data, scope]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inScope.filter((i) => !q || `${i.name} ${i.description}`.toLowerCase().includes(q));
  }, [inScope, query]);

  // "The repo has no subagent" is about .claude/agents only; user agents are the user's own.
  const noRepoAgents = kind === "agents" && data !== null && !data.some((i) => i.scope === "project");

  const keyOf = (i: LibraryItem) => `${i.scope}:${i.rel}`;
  const current = items.find((i) => keyOf(i) === picked) ?? items[0];

  const refresh = () => {
    void reload();
    void reloadInventory();
  };

  const flow = useSaveFlow({
    title: t(draft?.isNew ? "library.createTitle" : "library.saveTitle", { path: draft?.path ?? "" }),
    preview: () => libraryApi.libraryPreview(kind, draft!.scope, draft!.rel, draft!.content, draft!.baseHash),
    save: () => libraryApi.librarySave(kind, draft!.scope, draft!.rel, draft!.content, draft!.baseHash),
    onSaved: () => {
      if (draft!.isNew) toast(t("library.created", { path: draft!.path }));
      else backupToast(t("library.saved", { path: draft!.path }));
      clearDraft(draftKey(kind));
      setScope(draft!.scope);
      setPicked(`${draft!.scope}:${draft!.rel}`);
      refresh();
    },
  });

  const startEdit = async (item: LibraryItem) => {
    try {
      const raw = await libraryApi.libraryRaw(kind, item.scope, item.rel);
      setDraft(draftKey(kind), { kind, scope: item.scope, rel: item.rel, path: raw.path, content: raw.content, baseHash: raw.hash, isNew: false } satisfies LibraryDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <div className="page">
      <ConfigHeader title={copy.title} subtitle={copy.subtitle} />
      <KindTabs kind={kind} />
      <ConfigToolbar
        start={
          !draft && (
            <ScopeTabs
              value={scope}
              onChange={setScope}
              label={t("library.scopeTabs", { kind: copy.title.toLowerCase() })}
              labels={{ project: scopeDir(kind, "project"), user: scopeDir(kind, "user") }}
              scopes={LIBRARY_SCOPES}
              count={(s) => (data ?? []).filter((i) => i.scope === s).length}
            />
          )
        }
        loading={loading}
        onReload={refresh}
        actions={
          draft ? (
            <>
              <DraftControls draftKey={draftKey(kind)} />
              <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
                {t("action.review")}
              </Button>
            </>
          ) : (
            <>
              {kind === "agents" && (
                <Button icon={Robot} variant="quiet" title={t("library.templates.buttonTitle")} onClick={() => setInstalling(true)}>
                  {t("library.templates.button")}
                </Button>
              )}
              <Button icon={Plus} variant="primary" title={t("library.addTitle", { one: copy.one, dir: scopeDir(kind, scope) })} onClick={() => setCreating(true)}>
                {t("action.add")}
              </Button>
            </>
          )
        }
      />
      <LoadError error={error} />
      <div className="page-body">
        {!draft && noRepoAgents && <NoAgentsBanner onInstall={() => setInstalling(true)} />}
        {draft ? (
          <LibraryEditor draft={draft} />
        ) : data && inScope.length === 0 ? (
          <EmptyCard title={t("library.emptyTitle", { one: copy.one, dir: scopeDir(kind, scope) })}>{copy.empty}</EmptyCard>
        ) : (
          <div className="library">
            <div className="library-list">
              <label className="filter">
                <MagnifyingGlass aria-hidden="true" />
                <span className="sr-only">{t("library.filter")}</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("library.filterPlaceholder", { kind: copy.title.toLowerCase() })} />
              </label>
              <ul>
                {items.map((i) => {
                  const hidden = shadowedBy(kind, i, data ?? []);
                  return (
                    <li key={keyOf(i)}>
                      <button
                        type="button"
                        className="lib-item"
                        aria-current={current && keyOf(current) === keyOf(i) ? "true" : undefined}
                        onClick={() => setPicked(keyOf(i))}
                      >
                        <span className="lib-name mono">
                          {copy.prefix}
                          {i.name}
                        </span>
                        {(hidden || i.check) && (
                          <span className="lib-pills">
                            {hidden && (
                              <span className="shadow-pill" title={t("shadow.title", { scope: hidden })}>
                                {t("shadow.pill", { scope: hidden })}
                              </span>
                            )}
                            {i.check && <CheckPill check={i.check} />}
                          </span>
                        )}
                        {i.description && <span className="lib-desc">{i.description}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            {current && (
              <LibraryDetail
                key={keyOf(current)}
                item={current}
                prefix={copy.prefix}
                onEdit={() => void startEdit(current)}
                onDeleted={refresh}
              />
            )}
          </div>
        )}
      </div>
      {draft && <DiffDialog {...flow.dialog} confirmLabel={draft.isNew ? t("library.createFile") : t("library.saveFile")} />}
      {kind === "agents" && <TemplatesDialog open={installing} onClose={() => setInstalling(false)} onInstalled={refresh} />}
      <NewItemDialog
        open={creating}
        kind={kind}
        scope={scope}
        onClose={() => setCreating(false)}
        onCreate={async (name) => {
          const rel = relFor(kind, name);
          const raw = await libraryApi.libraryRaw(kind, scope, rel);
          if (raw.exists) throw new Error(t("library.exists", { path: raw.path }));
          setDraft(draftKey(kind), { kind, scope, rel, path: raw.path, content: template(kind, name), baseHash: raw.hash, isNew: true } satisfies LibraryDraft, null);
          setCreating(false);
        }}
      />
    </div>
  );
}

function LibraryEditor({ draft }: { draft: LibraryDraft }) {
  const { t } = useTranslation("config");
  return (
    <section className="card lib-editor" aria-label={t("library.editLabel", { path: draft.path })}>
      <header className="lib-head">
        <h2 className="mono">{draft.path}</h2>
        <ScopeTag scope={draft.scope} />
      </header>
      <Suspense fallback={<p className="hint">{t("library.editorLoading")}</p>}>
        <MarkdownEditor value={draft.content} label={t("library.contentLabel", { path: draft.path })} onChange={(content) => setDraft(draftKey(draft.kind), { ...draft, content })} />
      </Suspense>
    </section>
  );
}

function LibraryDetail({ item, prefix, onEdit, onDeleted }: { item: LibraryItem; prefix: string; onEdit: () => void; onDeleted: () => void }) {
  const { t } = useTranslation("config");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      const raw = await libraryApi.libraryRaw(item.kind, item.scope, item.rel);
      await libraryApi.libraryDelete(item.kind, item.scope, item.rel, raw.hash);
      backupToast(t("deletedRestorable", { name: item.path }));
      onDeleted();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <article className="card library-detail" aria-labelledby="lib-title">
      <header className="lib-head">
        <h2 id="lib-title" className="mono">
          {prefix}
          {item.name}
        </h2>
        <ScopeTag scope={item.scope} />
        <div className="lib-actions">
          <Button icon={PencilSimple} title={t("library.editTitle", { path: item.path })} onClick={onEdit}>
            {t("action.edit")}
          </Button>
          {confirmDelete ? (
            <Button icon={Trash} variant="danger" busy={busy} title={t("library.deleteTitle", { path: item.path })} onClick={() => void remove()}>
              {t("action.deleteConfirm")}
            </Button>
          ) : (
            <Button icon={Trash} variant="quiet" title={t("library.deleteTitle", { path: item.path })} onClick={() => setConfirmDelete(true)}>
              {t("action.delete")}
            </Button>
          )}
        </div>
      </header>
      <p className="mono lib-path">{item.path}</p>
      {confirmDelete && item.kind === "skills" && item.files && item.files.length > 0 && (
        <p className="hint">{t("library.skillDeleteHint", { count: item.files.length })}</p>
      )}
      {item.error && (
        <p className="error" role="alert">
          {item.error}
        </p>
      )}
      {item.description && <p className="lib-description">{item.description}</p>}
      {item.check && <CheckSection check={item.check} />}
      {item.fields.length > 0 && (
        <dl className="fields">
          {item.fields.map((f) => (
            <div key={f.key}>
              <dt>{f.key}</dt>
              <dd className="mono">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.files && item.files.length > 0 && (
        <div>
          <div className="pane-label">{t("library.files")}</div>
          <ul className="file-list">
            {item.files.map((f) => (
              <li key={f} className="mono">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="lib-body">
        <div className="pane-label">{t("library.body")}</div>
        <Markdown source={item.body} />
      </div>
    </article>
  );
}

function NewItemDialog(props: {
  open: boolean;
  kind: LibraryKind;
  scope: LibraryScope;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation(["config", "common"]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const pattern = props.kind === "commands" ? /^([A-Za-z0-9][\w-]*\/){0,2}[A-Za-z0-9][\w-]*$/ : /^[A-Za-z0-9][\w-]*$/;
  const valid = pattern.test(name);
  const copy = useCopy(props.kind);

  return (
    <AnimatePresence>
      {props.open && (
        <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-item-title"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await props.onCreate(name);
                setName("");
                setError(null);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <header className="dialog-head">
              <h2 id="new-item-title">{t("library.new.title", { one: copy.one })}</h2>
              <button type="button" className="icon-btn" onClick={props.onClose} aria-label={t("common:close")}>
                <X weight="bold" />
              </button>
            </header>
            <div className="form-grid">
              <label htmlFor={nameId}>{t("library.new.name")}</label>
              <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder={props.kind === "commands" ? "git/pr" : "reviewer"} autoFocus spellCheck={false} />
              <span className="field-help">
                {props.kind === "commands"
                  ? t("library.new.commandHelp")
                  : t("library.new.help", { file: relFor(props.kind, name || t("library.new.namePlaceholder")) })}
              </span>
              <span>{t("library.new.where")}</span>
              <span className="mono">
                {scopeDir(props.kind, props.scope)} ({props.scope === "project" ? t("library.new.thisRepo") : t("library.new.allRepos")})
              </span>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="dialog-actions">
              <Button variant="quiet" onClick={props.onClose}>
                {t("library.new.cancel")}
              </Button>
              <Button type="submit" icon={Plus} variant="primary" busy={busy} disabled={!valid}>
                {t("library.new.submit")}
              </Button>
            </footer>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
