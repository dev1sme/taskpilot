import { Plus, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import type { HookInput, Scope } from "../../api/types";
import { Button } from "../../shared/ui/Button";
import { toast } from "../../shared/ui/Toast";
import { clearDraft, setDraft } from "./drafts";
import { useSaveFlow } from "./useSaveFlow";

export interface HooksDraft {
  scope: Scope;
  hooks: HookInput[];
  baseHash: string;
  path: string;
}

export const hooksKey = (scope: Scope) => `hooks:${scope}`;

/** Hook events in the Claude Code hooks reference, the common ones first. */
export const EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionRequest",
  "PermissionDenied",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "Setup",
  "InstructionsLoaded",
  "MessageDisplay",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
  "ConfigChange",
  "CwdChanged",
  "DirectoryAdded",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "PreModelSwitch",
  "PostModelSwitch",
  "Elicitation",
  "ElicitationResult",
];

/** Row added by "Thêm hook". */
export const EMPTY_HOOK: HookInput = { event: "PostToolUse", matcher: "", command: "" };

function extraText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Review-then-save of a hooks draft; the page places the buttons and the dialog. */
export function useHooksSave(draft: HooksDraft | undefined, onSaved: () => void) {
  const { t } = useTranslation("config");
  return useSaveFlow({
    title: t("hooks.saveTitle", { path: draft?.path ?? "" }),
    preview: () => api.hooksPreview(draft!.scope, draft!.hooks, draft!.baseHash),
    save: () => api.hooksSave(draft!.scope, draft!.hooks, draft!.baseHash),
    onSaved: () => {
      toast(t("hooks.saved", { path: draft?.path }));
      clearDraft(hooksKey(draft!.scope));
      onSaved();
    },
  });
}

/** Command hooks of one settings file as editable rows. */
export function HooksEditor({ draft }: { draft: HooksDraft }) {
  const { t } = useTranslation("config");
  const setHooks = (hooks: HookInput[]) => setDraft(hooksKey(draft.scope), { ...draft, hooks });
  const update = (i: number, patch: Partial<HookInput>) => setHooks(draft.hooks.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  return (
    <section className="card hooks-editor" aria-label={t("hooks.editorLabel", { path: draft.path })}>
      <header className="scope-head">
        <h2 className="mono">{draft.path}</h2>
        <span className="scope-hint">{t("hooks.editorHint")}</span>
      </header>
      {draft.hooks.length === 0 && <p className="hint">{t("hooks.editorEmpty")}</p>}
      <ol className="hook-rows">
        {draft.hooks.map((h, i) => (
          <li key={i} className="hook-row">
            <label>
              <span className="field-label">{t("hooks.events")}</span>
              <select value={h.event} onChange={(e) => update(i, { event: e.target.value })}>
                {/* An event newer than this list stays selectable as it is in the file. */}
                {(EVENTS.includes(h.event) ? EVENTS : [h.event, ...EVENTS]).map((ev) => (
                  <option key={ev}>{ev}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">{t("hooks.matcher")}</span>
              <input value={h.matcher} onChange={(e) => update(i, { matcher: e.target.value })} placeholder="Edit|Write" spellCheck={false} />
            </label>
            <label className="hook-command-field">
              <span className="field-label">{t("hooks.command")}</span>
              <input value={h.command} onChange={(e) => update(i, { command: e.target.value })} placeholder="npx prettier --write ." spellCheck={false} />
            </label>
            <label className="hook-timeout-field">
              <span className="field-label">{t("hooks.timeout")}</span>
              <input
                type="number"
                min={1}
                max={3600}
                value={h.timeout ?? ""}
                onChange={(e) => update(i, { timeout: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
            <button type="button" className="rule-remove hook-remove" aria-label={t("hooks.remove", { n: i + 1 })} onClick={() => setHooks(draft.hooks.filter((_, j) => j !== i))}>
              <Trash weight="bold" />
            </button>
            {h.extra && (
              <p className="hook-extra" title={t("hooks.extraTitle")}>
                <span className="field-label">{t("hooks.extra")}</span>
                {Object.entries(h.extra).map(([k, v]) => (
                  <code key={k}>
                    {k}: {extraText(v)}
                  </code>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="perm-actions">
        <Button icon={Plus} variant="quiet" className="add-hook" onClick={() => setHooks([...draft.hooks, EMPTY_HOOK])}>
          {t("hooks.add")}
        </Button>
      </div>
    </section>
  );
}
