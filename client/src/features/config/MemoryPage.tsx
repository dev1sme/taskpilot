import { CheckCircle, Eye, PencilSimple, Plus, Warning } from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("config");
  const tabLabel = (s: Scope) => t(`memory.tab.${s}`);
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
    title: t("memory.saveTitle", { path: draft?.path ?? tabLabel(scope) }),
    preview: () => api.memoryPreview(scope, draft!.content, draft!.baseHash),
    save: () => api.memorySave(scope, draft!.content, draft!.baseHash),
    onSaved: () => {
      toast(t("memory.saved", { path: draft?.path }));
      clearDraft(draftKey(scope));
      void reload();
    },
  });

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={draftKey(scope)} />
      <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
        {t("action.review")}
      </Button>
    </>
  ) : (
    file && (
      <Button
        icon={file.exists ? PencilSimple : Plus}
        variant="primary"
        busy={opening}
        title={t(file.exists ? "memory.editTitle" : "memory.createTitle", { path: file.path })}
        onClick={() => void startEditing()}
      >
        {file.exists ? t("action.edit") : t("action.add")}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title={t("memory.title")} subtitle={t("memory.subtitle")} />
      <ConfigToolbar
        start={
          <ScopeTabs
            value={scope}
            onChange={setScope}
            label={t("memory.tabsLabel")}
            labels={{ project: tabLabel("project"), local: tabLabel("local"), user: tabLabel("user") }}
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
          <Suspense fallback={<p className="hint page-body">{t("library.editorLoading")}</p>}>
            <MarkdownEditor
              key={scope}
              value={draft.content}
              label={t("library.contentLabel", { path: draft.path })}
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
            <EmptyCard title={t("memory.missingTitle", { file: tabLabel(scope) })}>{t(`memory.missing.${scope}`)}</EmptyCard>
          </div>
        ))
      )}
      <DiffDialog {...flow.dialog} confirmLabel={t("library.saveFile")} />
    </div>
  );
}

function MemoryView({ file }: { file: MemoryFile }) {
  const { t } = useTranslation("config");
  const warnLines = new Set(file.checks.filter((c) => c.level === "warn" && c.line).map((c) => c.line));
  const importLines = new Set(file.imports.filter((i) => i.depth === 1).map((i) => i.line));
  const headingLines = new Set(file.headings.map((h) => h.line));
  const parts = [{ label: file.path, bytes: file.bytes }, ...file.imports.filter((i) => i.exists).map((i) => ({ label: i.ref, bytes: i.bytes }))];
  const total = parts.reduce((n, p) => n + p.bytes, 0);

  const jump = (line: number) => document.getElementById(`mem-L${line}`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="memory">
      <nav className="memory-outline" aria-label={t("memory.outline")}>
        <div className="pane-label">{t("memory.outline")}</div>
        {file.headings.length === 0 && <p className="hint">{t("memory.noHeadings")}</p>}
        {file.headings.map((h) => (
          <button key={h.line} type="button" className={`outline-item level-${h.level}`} onClick={() => jump(h.line)}>
            {h.text}
          </button>
        ))}
        {file.imports.length > 0 && (
          <>
            <div className="pane-label">{t("memory.imports")}</div>
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

      <section className="code-view" aria-label={t("library.contentLabel", { path: file.path })}>
        <div className="code-head">
          <span className="mono">{file.path}</span>
          <span className="code-meta">
            {t("memory.lines", { count: file.lines })}
            {file.mtime ? t("memory.modified", { time: clockTime(file.mtime) }) : ""}
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
          <h2 className="card-title">{t("memory.loads")}</h2>
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
          <h2 className="card-title">{t("memory.checks")}</h2>
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
                        {t("memory.line", { line: c.line })}
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
