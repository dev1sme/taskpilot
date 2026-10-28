import { Eye, PencilSimple, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { toast } from "../../../shared/ui/Toast";
import { getDraft, isDirty, setDraft, useDrafts } from "../shared/drafts";
import { EMPTY_HOOK, HooksEditor, hooksKey, useHooksSave, type HooksDraft } from "./HooksEditor";
import { ConfigHeader, ConfigToolbar, EmptyCard, LoadError } from "../shared/ConfigChrome";
import { DraftControls, ScopeTabs } from "../shared/ScopeControls";
import { configAdapters } from "../shared/provider-adapters";
import { useConfigCli, useConfigScopes, useConfigLifetime } from "../shared/CliContext";
import { useConfig } from "../shared/useConfig";
import { CopilotHooksPage } from "./CopilotHooksPage";
import { hooksApi } from "./api";
import type { HooksFile } from "./types";
import type { Scope } from "../shared/types";
import "../shared/code-view.css";
import "./hooks.css";

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
  const cli = useConfigCli();
  const editors = { claude: ClaudeHooksPage, copilot: CopilotHooksPage, unsupported: UnsupportedHooksPage };
  const Editor = editors[configAdapters[cli].hooksEditor];
  return <Editor />;
}

function UnsupportedHooksPage() {
  const { t } = useTranslation("config");
  return (
    <div className="page">
      <ConfigHeader title={t("hooks.title")} subtitle={t("hooks.codex.subtitle")} />
      <div className="page-body">
        <EmptyCard title={t("hooks.codex.title")}>{t("hooks.codex.body")}</EmptyCard>
      </div>
    </div>
  );
}

function ClaudeHooksPage() {
  const { t } = useTranslation("config");
  const tabLabel = (s: Scope) => t(`settings.tab.${s}`);
  const isActive = useConfigLifetime();
  const scopes = useConfigScopes();
  const [scope, setScope] = useState<Scope>(scopes[0] ?? "project");
  const { data, error, loading, reload } = useConfig(["hooks-file", scope], () => hooksApi.hooksFile(scope));
  const [opening, setOpening] = useState(false);
  useDrafts();
  const draft = getDraft<HooksDraft>(hooksKey(scope));
  const hasHooks = data?.raw != null && Object.keys(data.raw as object).length > 0;

  const startEditing = async () => {
    setOpening(true);
    try {
      const f = await hooksApi.hooksFile(scope);
      if (!isActive()) return;
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
        start={
          <ScopeTabs
            scopes={scopes}
            value={scope}
            onChange={(next) => { flow.dialog.onClose(); setScope(next); }}
            label={t("settings.tabsLabel")}
            labels={{ project: tabLabel("project"), local: tabLabel("local"), user: tabLabel("user") }}
            isDirty={(s) => isDirty(hooksKey(s))}
          />
        }
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
            <EmptyCard title={t("hooks.emptyTitle", { file: tabLabel(scope) })}>{t("hooks.emptyBody", { state: data.exists ? t("hooks.noSection") : t("settings.missingFile") })}</EmptyCard>
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
          <span className="mono">{`${file.path} › hooks`}</span>
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
