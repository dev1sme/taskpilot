import { Eye, MagnifyingGlass, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { LibraryItem, LibraryKind } from "../../api/types";
import { useWorkspace } from "../../app/workspace";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { Markdown } from "../../components/Markdown";
import { toast } from "../../components/Toast";
import { clearDraft, getDraft, setDraft, useDrafts } from "./drafts";
import { ConfigHeader, EmptyCard, LoadError, ScopeTag, UnsavedPill } from "./parts";
import { useConfig } from "./useConfig";
import { useSaveFlow } from "./useSaveFlow";
import "../../components/dialog.css";

const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

const COPY: Record<LibraryKind, { title: string; one: string; subtitle: string; empty: string; prefix: string }> = {
  agents: {
    title: "Agents",
    one: "agent",
    subtitle: "Subagent Claude có thể giao việc: .claude/agents và ~/.claude/agents",
    empty: "Chưa có agent. Mỗi agent là một file .md có frontmatter name, description, tools trong .claude/agents/.",
    prefix: "",
  },
  commands: {
    title: "Commands",
    one: "command",
    subtitle: "Slash command riêng: .claude/commands và ~/.claude/commands",
    empty: "Chưa có command. Mỗi file .md trong .claude/commands/ là một lệnh /tên-file.",
    prefix: "/",
  },
  skills: {
    title: "Skills",
    one: "skill",
    subtitle: "Skill Claude tự dùng khi phù hợp: .claude/skills và ~/.claude/skills",
    empty: "Chưa có skill. Mỗi skill là một thư mục có SKILL.md trong .claude/skills/.",
    prefix: "",
  },
};

/** Starting content for a new item; the user edits it before the first save. */
function template(kind: LibraryKind, name: string): string {
  const base = name.split("/").pop() ?? name;
  if (kind === "agents") {
    return `---\nname: ${base}\ndescription: Khi nào nên giao việc cho agent này\ntools: Read, Grep, Glob\n---\n\nBạn là ${base}. Mô tả cách làm việc ở đây.\n`;
  }
  if (kind === "commands") return `---\ndescription: Lệnh này làm gì\nargument-hint: [tham số]\n---\n\nNội dung prompt. Dùng $ARGUMENTS để nhận tham số.\n`;
  return `---\nname: ${base}\ndescription: Khi nào Claude nên dùng skill này\n---\n\n# ${base}\n\nCác bước thực hiện.\n`;
}

function relFor(kind: LibraryKind, name: string): string {
  return kind === "skills" ? `${name}/SKILL.md` : `${name}.md`;
}

interface LibraryDraft {
  kind: LibraryKind;
  scope: "project" | "user";
  rel: string;
  path: string;
  content: string;
  baseHash: string;
  isNew: boolean;
}

const draftKey = (kind: LibraryKind) => `library:${kind}`;

/** Agents, commands or skills: list + detail, with create, edit (diff review) and delete (backed up). */
export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const { data, error, loading, reload } = useConfig(() => api.library(kind));
  const { reloadInventory } = useWorkspace();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useDrafts();
  const draft = getDraft<LibraryDraft>(draftKey(kind));
  const copy = COPY[kind];

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((i) => !q || `${i.name} ${i.description}`.toLowerCase().includes(q));
  }, [data, query]);
  const keyOf = (i: LibraryItem) => `${i.scope}:${i.rel}`;
  const current = items.find((i) => keyOf(i) === picked) ?? items[0];

  const refresh = () => {
    void reload();
    void reloadInventory();
  };

  const startEdit = async (item: LibraryItem) => {
    try {
      const raw = await api.libraryRaw(kind, item.scope, item.rel);
      setDraft(draftKey(kind), { kind, scope: item.scope, rel: item.rel, path: raw.path, content: raw.content, baseHash: raw.hash, isNew: false } satisfies LibraryDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <div className="page">
      <ConfigHeader
        title={copy.title}
        subtitle={copy.subtitle}
        loading={loading}
        onReload={refresh}
        actions={
          !draft && (
            <Button icon={Plus} variant="primary" onClick={() => setCreating(true)}>
              Tạo {copy.one}
            </Button>
          )
        }
      />
      <LoadError error={error} />
      <div className="page-body">
        {draft ? (
          <LibraryEditor
            draft={draft}
            onSaved={(rel) => {
              setPicked(`${draft.scope}:${rel}`);
              refresh();
            }}
          />
        ) : data && data.length === 0 ? (
          <EmptyCard title={`Chưa có ${copy.one}`}>{copy.empty}</EmptyCard>
        ) : (
          <div className="library">
            <div className="library-list">
              <label className="filter">
                <MagnifyingGlass aria-hidden="true" />
                <span className="sr-only">Lọc</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Lọc ${copy.title.toLowerCase()}`} />
              </label>
              <ul>
                {items.map((i) => (
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
                      <ScopeTag scope={i.scope} />
                      {i.description && <span className="lib-desc">{i.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {current && <LibraryDetail key={keyOf(current)} item={current} prefix={copy.prefix} onEdit={() => void startEdit(current)} onDeleted={refresh} />}
          </div>
        )}
      </div>
      <NewItemDialog
        open={creating}
        kind={kind}
        onClose={() => setCreating(false)}
        onCreate={async (scope, name) => {
          const rel = relFor(kind, name);
          const raw = await api.libraryRaw(kind, scope, rel);
          if (raw.exists) throw new Error(`Đã có ${raw.path}`);
          setDraft(draftKey(kind), { kind, scope, rel, path: raw.path, content: template(kind, name), baseHash: raw.hash, isNew: true } satisfies LibraryDraft);
          setCreating(false);
        }}
      />
    </div>
  );
}

function LibraryEditor({ draft, onSaved }: { draft: LibraryDraft; onSaved: (rel: string) => void }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const flow = useSaveFlow({
    title: `${draft.isNew ? "Tạo" : "Lưu"} ${draft.path}`,
    preview: () => api.libraryPreview(draft.kind, draft.scope, draft.rel, draft.content, draft.baseHash),
    save: () => api.librarySave(draft.kind, draft.scope, draft.rel, draft.content, draft.baseHash),
    onSaved: () => {
      toast(draft.isNew ? `Đã tạo ${draft.path}.` : `Đã lưu ${draft.path}. Bản cũ nằm trong Lịch sử thay đổi.`);
      clearDraft(draftKey(draft.kind));
      onSaved(draft.rel);
    },
  });

  return (
    <section className="card lib-editor" aria-label={`Sửa ${draft.path}`}>
      <header className="lib-head">
        <h2 className="mono">{draft.path}</h2>
        <ScopeTag scope={draft.scope} />
        <div className="perm-actions lib-editor-actions">
          <UnsavedPill />
          {confirmDiscard ? (
            <Button icon={X} variant="danger" onClick={() => clearDraft(draftKey(draft.kind))}>
              Bỏ thay đổi
            </Button>
          ) : (
            <Button icon={X} variant="quiet" onClick={() => setConfirmDiscard(true)}>
              Huỷ
            </Button>
          )}
          <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
            Xem thay đổi &amp; lưu
          </Button>
        </div>
      </header>
      <Suspense fallback={<p className="hint">Đang mở editor…</p>}>
        <MarkdownEditor value={draft.content} label={`Nội dung ${draft.path}`} onChange={(content) => setDraft(draftKey(draft.kind), { ...draft, content })} />
      </Suspense>
      <DiffDialog {...flow.dialog} confirmLabel={draft.isNew ? "Tạo file" : "Lưu file"} />
    </section>
  );
}

function LibraryDetail({ item, prefix, onEdit, onDeleted }: { item: LibraryItem; prefix: string; onEdit: () => void; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      const raw = await api.libraryRaw(item.kind, item.scope, item.rel);
      await api.libraryDelete(item.kind, item.scope, item.rel, raw.hash);
      toast(`Đã xoá ${item.path}. Có thể khôi phục trong Lịch sử thay đổi.`);
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
          <Button icon={PencilSimple} onClick={onEdit}>
            Sửa
          </Button>
          {confirmDelete ? (
            <Button icon={Trash} variant="danger" busy={busy} onClick={() => void remove()}>
              {item.kind === "skills" ? "Xoá SKILL.md" : "Xác nhận xoá"}
            </Button>
          ) : (
            <Button icon={Trash} variant="quiet" onClick={() => setConfirmDelete(true)}>
              Xoá
            </Button>
          )}
        </div>
      </header>
      <p className="mono lib-path">{item.path}</p>
      {confirmDelete && item.kind === "skills" && item.files && item.files.length > 0 && (
        <p className="hint">Chỉ xoá SKILL.md; {item.files.length} file khác trong thư mục giữ nguyên.</p>
      )}
      {item.error && (
        <p className="error" role="alert">
          {item.error}
        </p>
      )}
      {item.description && <p className="lib-description">{item.description}</p>}
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
          <div className="pane-label">File đi kèm</div>
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
        <div className="pane-label">Nội dung</div>
        <Markdown source={item.body} />
      </div>
    </article>
  );
}

function NewItemDialog(props: {
  open: boolean;
  kind: LibraryKind;
  onClose: () => void;
  onCreate: (scope: "project" | "user", name: string) => Promise<void>;
}) {
  const [scope, setScope] = useState<"project" | "user">("project");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const pattern = props.kind === "commands" ? /^([A-Za-z0-9][\w-]*\/){0,2}[A-Za-z0-9][\w-]*$/ : /^[A-Za-z0-9][\w-]*$/;
  const valid = pattern.test(name);
  const copy = COPY[props.kind];

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
                await props.onCreate(scope, name);
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
              <h2 id="new-item-title">Tạo {copy.one}</h2>
              <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Đóng">
                <X weight="bold" />
              </button>
            </header>
            <div className="form-grid">
              <label htmlFor={nameId}>Tên</label>
              <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder={props.kind === "commands" ? "git/pr" : "reviewer"} autoFocus spellCheck={false} />
              <span className="field-help">
                {props.kind === "commands"
                  ? "Chữ, số, - _; có thể có thư mục con (git/pr → /git:pr)."
                  : "Chữ, số, - _. Sẽ tạo " + (props.kind === "skills" ? `${name || "tên"}/SKILL.md` : `${name || "tên"}.md`)}
              </span>
              <span>Nơi lưu</span>
              <div className="segmented" role="radiogroup" aria-label="Nơi lưu">
                {(["project", "user"] as const).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={scope === s} aria-selected={scope === s} onClick={() => setScope(s)}>
                    {s === "project" ? `.claude/${props.kind} (repo)` : `~/.claude/${props.kind} (mọi repo)`}
                  </button>
                ))}
              </div>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="dialog-actions">
              <Button variant="quiet" onClick={props.onClose}>
                Huỷ
              </Button>
              <Button type="submit" icon={Plus} variant="primary" busy={busy} disabled={!valid}>
                Tạo và mở editor
              </Button>
            </footer>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
