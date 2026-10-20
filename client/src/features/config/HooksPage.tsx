import { Eye, PencilSimple, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import type { HooksFile, Scope } from "../../api/types";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { toast } from "../../components/Toast";
import { getDraft, isDirty, setDraft, useDrafts } from "./drafts";
import { EMPTY_HOOK, HooksEditor, hooksKey, useHooksSave, type HooksDraft } from "./HooksEditor";
import { ConfigHeader, ConfigToolbar, DraftControls, EmptyCard, LoadError, ScopeTabs } from "./parts";
import { useConfig } from "./useConfig";

/** Events with a one-line explanation in `config:hooks.event`. */
const HINTED_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
] as const;
const hinted = (name: string): name is (typeof HINTED_EVENTS)[number] => (HINTED_EVENTS as readonly string[]).includes(name);

/** An event key in the pretty-printed hooks block: `  "PostToolUse": [`. */
const EVENT_LINE = /^ {2}"([^"]+)": \[/;

/** Hooks of one settings file at a time, shown as the JSON block written in the file; edited as rows. */
export function HooksPage() {
  const { t } = useTranslation("config");
  const tabLabel = (s: Scope) => t(`settings.tab.${s}`);
  const [scope, setScope] = useState<Scope>("project");
  const { data, error, loading, reload } = useConfig(["hooks-file", scope], () => api.hooksFile(scope));
  const [opening, setOpening] = useState(false);
  useDrafts();
  const draft = getDraft<HooksDraft>(hooksKey(scope));
  const hasHooks = data?.raw != null && Object.keys(data.raw as object).length > 0;

  const startEditing = async () => {
    setOpening(true);
    try {
      const f = await api.hooksFile(scope);
      const base: HooksDraft = { scope, hooks: f.hooks, baseHash: f.hash, path: f.path };
      // A file without command hooks opens with one empty row to fill in; that row alone is not a change.
      setDraft(hooksKey(scope), f.hooks.length ? base : { ...base, hooks: [EMPTY_HOOK] });
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = useHooksSave(draft, () => void reload());

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={hooksKey(scope)} />
      <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
        {t("action.review")}
      </Button>
    </>
  ) : (
    data && (
      <Button
        icon={hasHooks ? PencilSimple : Plus}
        variant="primary"
        busy={opening}
        title={t(hasHooks ? "hooks.editTitle" : "hooks.addTitle", { path: data.path })}
        onClick={() => void startEditing()}
      >
        {hasHooks ? t("action.edit") : t("action.add")}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title={t("hooks.title")} subtitle={t("hooks.subtitle")} />
      <ConfigToolbar
        start={<ScopeTabs value={scope} onChange={setScope} label={t("settings.tabsLabel")} labels={{ project: tabLabel("project"), local: tabLabel("local"), user: tabLabel("user") }} isDirty={(s) => isDirty(hooksKey(s))} />}
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      {draft ? (
        <div className="page-body hooks">
          <HooksEditor draft={draft} />
        </div>
      ) : (
        data &&
        (hasHooks ? (
          <HooksView file={data} />
        ) : (
          <div className="page-body">
            <EmptyCard title={t("hooks.emptyTitle", { file: tabLabel(scope) })}>
              {t("hooks.emptyBody", { state: data.exists ? t("hooks.noSection") : t("settings.missingFile") })}
            </EmptyCard>
          </div>
        ))
      )}
      <DiffDialog {...flow.dialog} confirmLabel={t("hooks.confirm")} />
    </div>
  );
}

function HooksView({ file }: { file: HooksFile }) {
  const { t } = useTranslation("config");
  const lines = JSON.stringify(file.raw, null, 2).split("\n");
  const events = lines.flatMap((text, i) => {
    const m = EVENT_LINE.exec(text);
    return m ? [{ name: m[1], line: i + 1 }] : [];
  });

  const jump = (line: number) => document.getElementById(`hook-L${line}`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="memory hooks-view">
      <nav className="memory-outline" aria-label={t("hooks.events")}>
        <div className="pane-label">{t("hooks.events")}</div>
        {events.map((e) => {
          const hint = hinted(e.name) ? t(`hooks.event.${e.name}`) : undefined;
          return (
            <button key={e.line} type="button" className="outline-item hook-event" title={hint} onClick={() => jump(e.line)}>
              <span className="mono">{e.name}</span>
              {hint && <span className="hook-event-hint">{hint}</span>}
            </button>
          );
        })}
      </nav>

      <section className="code-view" aria-label={t("hooks.codeLabel", { path: file.path })}>
        <div className="code-head">
          <span className="mono">
            {file.path} › hooks
          </span>
          <span className="code-meta">{t("hooks.lines", { count: lines.length })}</span>
        </div>
        <ol className="code-lines">
          {lines.map((text, i) => {
            const n = i + 1;
            return (
              <li key={n} id={`hook-L${n}`} className={EVENT_LINE.test(text) ? "is-heading" : undefined}>
                <span className="ln" aria-hidden="true">
                  {n}
                </span>
                <span className="lt">{text}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
