import { CheckCircle, Eye, PencilSimple, Plus, Warning } from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { api } from "../../api/client";
import type { MemoryFile, Scope } from "../../api/types";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { clockTime } from "../../components/Elapsed";
import { toast } from "../../components/Toast";
import { clearDraft, getDraft, isDirty, setDraft, useDrafts } from "./drafts";
import { ConfigHeader, ConfigToolbar, DraftControls, EmptyCard, LoadError, ScopeTabs } from "./parts";
import { useConfig } from "./useConfig";
import { useSaveFlow } from "./useSaveFlow";

const TAB_LABEL: Record<Scope, string> = { project: "CLAUDE.md", local: "CLAUDE.local.md", user: "~/.claude/CLAUDE.md" };
const MISSING: Record<Scope, string> = {
  project: "Repo chưa có CLAUDE.md. Đây là nơi ghi quy ước của repo để Claude đọc ở đầu mỗi session.",
  local: "Chưa có CLAUDE.local.md: ghi chú riêng của ba cho repo này, không commit lên git.",
  user: "Chưa có ~/.claude/CLAUDE.md: hướng dẫn chung cho mọi repo trên máy ba.",
};
// CodeMirror is only needed once the user starts editing.
const MarkdownEditor = lazy(() => import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

const STACK_COLORS = ["var(--cat-read)", "var(--cat-search)", "var(--cat-run)", "var(--cat-agent)", "var(--cat-plan)"];

interface MemoryDraft {
  content: string;
  baseHash: string;
  path: string;
}

const draftKey = (scope: Scope) => `memory:${scope}`;

/** CLAUDE.md files as Claude loads them; editable with diff review, backups and conflict checks. */
export function MemoryPage() {
  const { data, error, loading, reload } = useConfig(["memory"], api.memory);
  const [scope, setScope] = useState<Scope>("project");
  const [opening, setOpening] = useState(false);
  useDrafts();
  const draft = getDraft<MemoryDraft>(draftKey(scope));
  const file = data?.find((f) => f.scope === scope);

  const startEditing = async () => {
    setOpening(true);
    try {
      const raw = await api.memoryRaw(scope);
      setDraft(draftKey(scope), { content: raw.content, baseHash: raw.hash, path: raw.path } satisfies MemoryDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = useSaveFlow({
    title: `Lưu ${draft?.path ?? TAB_LABEL[scope]}`,
    preview: () => api.memoryPreview(scope, draft!.content, draft!.baseHash),
    save: () => api.memorySave(scope, draft!.content, draft!.baseHash),
    onSaved: () => {
      toast(`Đã lưu ${draft?.path}. Bản cũ nằm trong Lịch sử thay đổi.`);
      clearDraft(draftKey(scope));
      void reload();
    },
  });

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={draftKey(scope)} />
      <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
        Xem thay đổi &amp; lưu
      </Button>
    </>
  ) : (
    file && (
      <Button
        icon={file.exists ? PencilSimple : Plus}
        variant="primary"
        busy={opening}
        title={`${file.exists ? "Sửa" : "Tạo"} ${file.path}`}
        onClick={() => void startEditing()}
      >
        {file.exists ? "Sửa" : "Thêm"}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title="CLAUDE.md" subtitle="Hướng dẫn Claude đọc ở đầu mỗi session trong repo này" />
      <ConfigToolbar
        start={
          <ScopeTabs
            value={scope}
            onChange={setScope}
            label="File memory"
            labels={TAB_LABEL}
            isMissing={(s) => data?.find((x) => x.scope === s)?.exists === false && !getDraft(draftKey(s))}
            isDirty={(s) => isDirty(draftKey(s))}
          />
        }
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      {draft ? (
        <div className="memory is-editing">
          <Suspense fallback={<p className="hint page-body">Đang mở editor…</p>}>
            <MarkdownEditor
              key={scope}
              value={draft.content}
              label={`Nội dung ${draft.path}`}
              onChange={(content) => setDraft(draftKey(scope), { ...draft, content })}
            />
          </Suspense>
        </div>
      ) : (
        file &&
        (file.exists ? (
          <MemoryView file={file} />
        ) : (
          <div className="page-body">
            <EmptyCard title={`Chưa có ${TAB_LABEL[scope]}`}>{MISSING[scope]}</EmptyCard>
          </div>
        ))
      )}
      <DiffDialog {...flow.dialog} confirmLabel="Lưu file" />
    </div>
  );
}

function MemoryView({ file }: { file: MemoryFile }) {
  const warnLines = new Set(file.checks.filter((c) => c.level === "warn" && c.line).map((c) => c.line));
  const importLines = new Set(file.imports.filter((i) => i.depth === 1).map((i) => i.line));
  const headingLines = new Set(file.headings.map((h) => h.line));
  const parts = [{ label: file.path, bytes: file.bytes }, ...file.imports.filter((i) => i.exists).map((i) => ({ label: i.ref, bytes: i.bytes }))];
  const total = parts.reduce((n, p) => n + p.bytes, 0);

  const jump = (line: number) => document.getElementById(`mem-L${line}`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="memory">
      <nav className="memory-outline" aria-label="Mục lục">
        <div className="pane-label">Mục lục</div>
        {file.headings.length === 0 && <p className="hint">Không có tiêu đề.</p>}
        {file.headings.map((h) => (
          <button key={h.line} type="button" className={`outline-item level-${h.level}`} onClick={() => jump(h.line)}>
            {h.text}
          </button>
        ))}
        {file.imports.length > 0 && (
          <>
            <div className="pane-label">Import</div>
            {file.imports.map((i) => (
              <button
                key={`${i.ref}-${i.line}-${i.depth}`}
                type="button"
                className={`outline-item mono${i.exists ? "" : " is-missing"}`}
                style={{ paddingLeft: 8 + (i.depth - 1) * 12 }}
                onClick={() => i.depth === 1 && jump(i.line)}
              >
                @{i.ref}
              </button>
            ))}
          </>
        )}
      </nav>

      <section className="code-view" aria-label={`Nội dung ${file.path}`}>
        <div className="code-head">
          <span className="mono">{file.path}</span>
          <span className="code-meta">
            {file.lines} dòng{file.mtime ? ` · sửa lúc ${clockTime(file.mtime)}` : ""}
          </span>
        </div>
        <ol className="code-lines">
          {file.content.split("\n").map((text, i) => {
            const n = i + 1;
            const cls = warnLines.has(n) ? "is-warn" : headingLines.has(n) ? "is-heading" : importLines.has(n) ? "is-import" : "";
            return (
              <li key={n} id={`mem-L${n}`} className={cls}>
                <span className="ln" aria-hidden="true">
                  {n}
                </span>
                <span className="lt">{text || " "}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <aside className="memory-side">
        <section className="card">
          <h2 className="card-title">Claude sẽ nạp</h2>
          <div className="big-stat">
            ~{formatTokens(total / 4)} <span>token</span>
          </div>
          <div className="stack-bar" aria-hidden="true">
            {parts.map((p, i) => (
              <span key={p.label} style={{ flex: Math.max(p.bytes, 1), background: STACK_COLORS[i % STACK_COLORS.length] }} />
            ))}
          </div>
          <ul className="legend">
            {parts.map((p, i) => (
              <li key={p.label}>
                <span className="legend-dot" style={{ background: STACK_COLORS[i % STACK_COLORS.length] }} aria-hidden="true" />
                <span className="mono legend-name">{p.label}</span>
                <span className="legend-value">{formatTokens(p.bytes / 4)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="card-title">Kiểm tra</h2>
          <ul className="checks">
            {file.checks.map((c, i) => (
              <li key={i} className={`check-${c.level}`}>
                {c.level === "ok" ? <CheckCircle weight="fill" aria-hidden="true" /> : <Warning weight="fill" aria-hidden="true" />}
                <span>
                  {c.message}
                  {c.line && (
                    <>
                      {" "}
                      <button type="button" className="link-btn" onClick={() => jump(c.line!)}>
                        dòng {c.line}
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function formatTokens(n: number): string {
  return n < 1000 ? String(Math.max(10, Math.round(n / 10) * 10)) : `${(n / 1000).toFixed(1)}k`;
}
