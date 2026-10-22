import { Plus, X } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { clearDraft, setDraft } from "../shared/drafts";
import { backupToast, RuleChip } from "../shared/parts";
import { useSaveFlow } from "../shared/useSaveFlow";
import { settingsApi } from "./api";
import type { Permissions } from "./types";
import type { Scope } from "../shared/types";
import "./settings.css";

export interface PermissionsDraft {
  permissions: Permissions;
  baseHash: string;
  path: string;
  /** defaultMode the file has when the draft was opened; the server accepts a mode that is not offered only if it equals this. */
  fileMode: string | null;
}

export const permissionsKey = (scope: Scope) => `settings:${scope}`;

/** Default modes offered; "" leaves the key unset. Labels are `config:permissions.mode.<mode>`. */
const MODES = ["", "default", "acceptEdits", "plan", "auto"] as const;

const COLUMNS: Array<{ key: "allow" | "ask" | "deny"; example: string }> = [
  { key: "allow", example: "Bash(npm test)" },
  { key: "ask", example: "Bash(git push *)" },
  { key: "deny", example: "Read(./.env)" },
];

/** Review-then-save of a permissions draft; the page places the buttons and the dialog. */
export function usePermissionsSave(scope: Scope, draft: PermissionsDraft | undefined, onSaved: () => void) {
  const { t } = useTranslation("config");
  return useSaveFlow({
    title: t("permissions.saveTitle", { path: draft?.path ?? "" }),
    preview: () => settingsApi.permissionsPreview(scope, draft!.permissions, draft!.baseHash),
    save: () => settingsApi.permissionsSave(scope, draft!.permissions, draft!.baseHash),
    onSaved: () => {
      backupToast(t("permissions.saved", { path: draft?.path }));
      clearDraft(permissionsKey(scope));
      onSaved();
    },
  });
}

/** Edits allow/ask/deny rules and the default mode of one settings file. */
export function PermissionsEditor({ scope, draft }: { scope: Scope; draft: PermissionsDraft }) {
  const { t } = useTranslation("config");
  const modeId = useId();
  const update = (p: Partial<Permissions>) => setDraft(permissionsKey(scope), { ...draft, permissions: { ...draft.permissions, ...p } });

  return (
    <div className="perm-editor">
      <div className="perm-mode">
        <label htmlFor={modeId}>{t("permissions.defaultMode")}</label>
        <select id={modeId} value={draft.permissions.defaultMode ?? ""} onChange={(e) => update({ defaultMode: e.target.value || null })}>
          {MODES.map((value) => (
            <option key={value} value={value}>
              {t(`permissions.mode.${value || "unset"}`)}
            </option>
          ))}
          {draft.fileMode && !(MODES as readonly string[]).includes(draft.fileMode) && <option value={draft.fileMode}>{t("permissions.mode.keep", { mode: draft.fileMode })}</option>}
        </select>
      </div>

      <div className="rule-columns">
        {COLUMNS.map((c) => (
          <RuleColumn key={c.key} title={t(`settings.column.${c.key}`)} tone={c.key} example={c.example} rules={draft.permissions[c.key]} onChange={(rules) => update({ [c.key]: rules })} />
        ))}
      </div>
    </div>
  );
}

function RuleColumn(props: { title: string; tone: "allow" | "ask" | "deny"; example: string; rules: string[]; onChange: (rules: string[]) => void }) {
  const { t } = useTranslation("config");
  const [value, setValue] = useState("");
  const inputId = useId();
  const add = () => {
    const rule = value.trim();
    if (!rule) return;
    if (!props.rules.includes(rule)) props.onChange([...props.rules, rule]);
    setValue("");
  };

  return (
    <div className={`rule-list tone-${props.tone}`}>
      <div className="rule-list-head">
        {props.title} <span>{props.rules.length}</span>
      </div>
      <ul>
        {props.rules.map((r) => (
          <li key={r} className="rule-row">
            <RuleChip rule={r} />
            <button type="button" className="rule-remove" aria-label={t("permissions.removeRule", { rule: r })} onClick={() => props.onChange(props.rules.filter((x) => x !== r))}>
              <X weight="bold" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="rule-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {t("permissions.addRule", { column: props.title.toLowerCase() })}
        </label>
        <input id={inputId} value={value} onChange={(e) => setValue(e.target.value)} placeholder={props.example} spellCheck={false} />
        <button type="submit" className="rule-add-btn" aria-label={t("permissions.addTo", { column: props.title })} disabled={!value.trim()}>
          <Plus weight="bold" />
        </button>
      </form>
    </div>
  );
}
