import { Plus, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import type { CopilotHookInput } from "./types";

export const COPILOT_EVENTS = [
  "agentStop",
  "errorOccurred",
  "notification",
  "permissionRequest",
  "postToolUse",
  "postToolUseFailure",
  "preCompact",
  "preToolUse",
  "sessionEnd",
  "sessionStart",
  "subagentStart",
  "subagentStop",
  "userPromptSubmitted",
  "userPromptTransformed",
  "Stop",
  "UserPromptSubmit",
] as const;

const MATCHER_EVENTS = new Set(["notification", "permissionRequest", "postToolUse", "preCompact", "preToolUse", "subagentStart"]);
type CommandField = "command" | "bash" | "powershell";
const SHELL_FIELDS: CommandField[] = ["command", "bash", "powershell"];

export const EMPTY_COPILOT_HOOK: CopilotHookInput = { event: "postToolUse", command: "" };

/** Copilot command hooks use one flat entry per event; Claude matchers and timeout fields do not apply. */
export function CopilotHooksEditor({ path, hooks, onChange }: { path: string; hooks: CopilotHookInput[]; onChange: (hooks: CopilotHookInput[]) => void }) {
  const { t } = useTranslation("config");
  const update = (index: number, hook: CopilotHookInput) => onChange(hooks.map((item, i) => (i === index ? hook : item)));

  return (
    <section className="card hooks-editor" aria-label={t("hooks.editorLabel", { path })}>
      <header className="scope-head">
        <h2 className="mono">{path}</h2>
        <span className="scope-hint">{t("hooks.copilot.editorHint")}</span>
      </header>
      {hooks.length === 0 && <p className="hint">{t("hooks.editorEmpty")}</p>}
      <ol className="hook-rows">
        {hooks.map((hook, index) => {
          const execMode = hook.exec !== undefined;
          const matcherAllowed = MATCHER_EVENTS.has(hook.event[0]?.toLowerCase() + hook.event.slice(1));
          return (
            <li key={index} className="hook-row copilot-hook-row">
              <label>
                <span className="field-label">{t("hooks.events")}</span>
                <select
                  value={hook.event}
                  onChange={(event) => {
                    const nextEvent = event.target.value;
                    update(index, { ...hook, event: nextEvent, ...(MATCHER_EVENTS.has(nextEvent[0]?.toLowerCase() + nextEvent.slice(1)) ? {} : { matcher: undefined }) });
                  }}
                >
                  {(COPILOT_EVENTS as readonly string[]).includes(hook.event) ? null : <option value={hook.event}>{hook.event}</option>}
                  {COPILOT_EVENTS.map((event) => (
                    <option key={event} value={event}>
                      {event}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">{t("hooks.copilot.mode")}</span>
                <select
                  value={execMode ? "exec" : "shell"}
                  onChange={(event) =>
                    update(
                      index,
                      event.target.value === "exec" ? { event: hook.event, matcher: hook.matcher, exec: "", args: [] } : { event: hook.event, matcher: hook.matcher, command: "" },
                    )
                  }
                >
                  <option value="shell">{t("hooks.copilot.shell")}</option>
                  <option value="exec">{t("hooks.copilot.executable")}</option>
                </select>
              </label>
              {matcherAllowed && (
                <label>
                  <span className="field-label">{t("hooks.matcher")}</span>
                  <input
                    value={hook.matcher ?? ""}
                    onChange={(event) => update(index, { ...hook, matcher: event.target.value || undefined })}
                    placeholder={t("hooks.copilot.matcherPlaceholder")}
                    spellCheck={false}
                  />
                </label>
              )}
              {execMode ? (
                <>
                  <label className="hook-command-field">
                    <span className="field-label">{t("hooks.copilot.exec")}</span>
                    <input value={hook.exec ?? ""} onChange={(event) => update(index, { ...hook, exec: event.target.value })} spellCheck={false} />
                  </label>
                  <label className="hook-command-field">
                    <span className="field-label">{t("hooks.copilot.args")}</span>
                    <textarea
                      value={(hook.args ?? []).join("\n")}
                      onChange={(event) => update(index, { ...hook, args: event.target.value ? event.target.value.split("\n") : [] })}
                      placeholder={t("hooks.copilot.argsHint")}
                      spellCheck={false}
                    />
                  </label>
                </>
              ) : (
                SHELL_FIELDS.map((field) => (
                  <label key={field} className="hook-command-field">
                    <span className="field-label">{field}</span>
                    <input value={hook[field] ?? ""} onChange={(event) => update(index, { ...hook, [field]: event.target.value || undefined })} spellCheck={false} />
                  </label>
                ))
              )}
              <label className="hook-command-field">
                <span className="field-label">{t("hooks.copilot.cwd")}</span>
                <input value={hook.cwd ?? ""} onChange={(event) => update(index, { ...hook, cwd: event.target.value || undefined })} spellCheck={false} />
              </label>
              <label className="hook-timeout-field">
                <span className="field-label">{t("hooks.copilot.timeoutSec")}</span>
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={hook.timeoutSec ?? ""}
                  onChange={(event) => update(index, { ...hook, timeoutSec: event.target.value ? Number(event.target.value) : undefined })}
                />
              </label>
              <button type="button" className="rule-remove hook-remove" aria-label={t("hooks.remove", { n: index + 1 })} onClick={() => onChange(hooks.filter((_, i) => i !== index))}>
                <Trash weight="bold" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="perm-actions">
        <Button icon={Plus} variant="quiet" className="add-hook" onClick={() => onChange([...hooks, { ...EMPTY_COPILOT_HOOK }])}>
          {t("hooks.add")}
        </Button>
      </div>
    </section>
  );
}
