import { CheckCircle, Eye, PencilSimple, Plus, Warning } from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { clockTime } from "../../../shared/ui/Elapsed";
import { toast } from "../../../shared/ui/Toast";
import type { ProviderId } from "../../../shared/providers";
import { clearDraft, configDraftKey, getDraft, isDirty, setDraft, useDrafts } from "../shared/drafts";
import { backupToast, ConfigHeader, ConfigToolbar, EmptyCard, LoadError } from "../shared/ConfigChrome";
import { DraftControls, ScopeTabs } from "../shared/ScopeControls";
import { useConfigCli } from "../shared/CliContext";
import { useConfig } from "../shared/useConfig";
import { useSaveFlow } from "../shared/useSaveFlow";
import { memoryApi } from "./api";
import type { MemoryFile } from "./types";
import type { Scope } from "../shared/types";
import "../shared/code-view.css";
import "./memory.css";

// CodeMirror is only needed once the user starts editing.
const MarkdownEditor = lazy(() => import("../shared/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

const STACK_COLORS = ["var(--cat-read)", "var(--cat-search)", "var(--cat-run)", "var(--cat-agent)", "var(--cat-plan)"];

interface MemoryDraft {
  content: string;
  baseHash: string;
  path: string;
}

const draftKey = (cli: ProviderId, scope: Scope) => configDraftKey(cli, `memory:${scope}`);

/** Instruction files for the selected CLI, editable with diff review and backups. */
export function MemoryPage() {
  const cli = useConfigCli();
  return <MemoryPageForCli key={cli} cli={cli} />;
}

function MemoryPageForCli({ cli }: { cli: ProviderId }) {
  const { t } = useTranslation("config");
  const { data, error, loading, reload } = useConfig(["memory", cli], () => memoryApi.memory(cli));
  const [scope, setScope] = useState<Scope>("project");
  const [opening, setOpening] = useState(false);
  useDrafts();
  const tabLabel = (s: Scope) => data?.find((f) => f.scope === s)?.path ?? t(`memory.tab.${s}`);
  const draft = getDraft<MemoryDraft>(draftKey(cli, scope));
  const file = data?.find((f) => f.scope === scope);

  const startEditing = async () => {
    setOpening(true);
    try {
      const raw = await memoryApi.memoryRaw(cli, scope);
      setDraft(draftKey(cli, scope), { content: raw.content, baseHash: raw.hash, path: raw.path } satisfies MemoryDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = useSaveFlow({
    title: t("memory.saveTitle", { path: draft?.path ?? tabLabel(scope) }),
    preview: () => memoryApi.memoryPreview(cli, scope, draft!.content, draft!.baseHash),
    save: () => memoryApi.memorySave(cli, scope, draft!.content, draft!.baseHash),
    onSaved: () => {
      backupToast(t("memory.saved", { path: draft?.path }));
      clearDraft(draftKey(cli, scope));
      void reload();
    },
  });

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={draftKey(cli, scope)} />
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
      <ConfigHeader title={t(cli === "claude" ? "memory.title" : `memory.cli.${cli}.title`)} subtitle={t(cli === "claude" ? "memory.subtitle" : `memory.cli.${cli}.subtitle`)} />
      <ConfigToolbar
        start={
          <ScopeTabs
            value={scope}
            onChange={(next) => {
              flow.dialog.onClose();
              setScope(next);
            }}
            label={t("memory.tabsLabel")}
            labels={{ project: tabLabel("project"), local: tabLabel("local"), user: tabLabel("user") }}
            scopes={data?.map((f) => f.scope) ?? []}
            isMissing={(s) => data?.find((x) => x.scope === s)?.exists === false && !getDraft(draftKey(cli, s))}
            isDirty={(s) => isDirty(draftKey(cli, s))}
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
              onChange={(content) => setDraft(draftKey(cli, scope), { ...draft, content })}
            />
          </Suspense>
        </div>
      ) : (
        file &&
        (file.exists ? (
          <MemoryView file={file} cli={cli} />
        ) : (
          <div className="page-body">
            <EmptyCard title={t("memory.missingTitle", { file: tabLabel(scope) })}>
              {t(cli === "claude" || scope === "local" ? `memory.missing.${scope}` : `memory.cli.${cli}.missing.${scope}`)}
            </EmptyCard>
          </div>
        ))
      )}
      <DiffDialog {...flow.dialog} confirmLabel={t("library.saveFile")} />
    </div>
  );
}

function MemoryView({ file, cli }: { file: MemoryFile; cli: ProviderId }) {
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
          <h2 className="card-title">{t(cli === "claude" ? "memory.loads" : "memory.loadsEstimate")}</h2>
          <div className="big-stat">
            ~{formatTokens(total / 4)} <span>{t("memory.tokenUnit")}</span>
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
