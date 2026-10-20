import { Plus, X } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { api } from "../../api/client";
import type { Permissions, Scope } from "../../api/types";
import { toast } from "../../components/Toast";
import { clearDraft, setDraft } from "./drafts";
import { RuleChip } from "./parts";
import { useSaveFlow } from "./useSaveFlow";

export interface PermissionsDraft {
  permissions: Permissions;
  baseHash: string;
  path: string;
}

export const permissionsKey = (scope: Scope) => `settings:${scope}`;

const MODES: Array<[string, string]> = [
  ["", "Không đặt (theo mặc định của Claude)"],
  ["default", "default · hỏi trước mỗi thao tác cần quyền"],
  ["acceptEdits", "acceptEdits · tự sửa file, hỏi trước lệnh shell"],
  ["plan", "plan · chỉ lập kế hoạch"],
  ["auto", "auto · tự quyết theo mức rủi ro"],
];

const COLUMNS: Array<{ key: "allow" | "ask" | "deny"; title: string; example: string }> = [
  { key: "allow", title: "Cho phép", example: "Bash(npm test)" },
  { key: "ask", title: "Hỏi trước", example: "Bash(git push *)" },
  { key: "deny", title: "Chặn", example: "Read(./.env)" },
];

/** Review-then-save of a permissions draft; the page places the buttons and the dialog. */
export function usePermissionsSave(scope: Scope, draft: PermissionsDraft | undefined, onSaved: () => void) {
  return useSaveFlow({
    title: `Lưu quyền vào ${draft?.path ?? ""}`,
    preview: () => api.permissionsPreview(scope, draft!.permissions, draft!.baseHash),
    save: () => api.permissionsSave(scope, draft!.permissions, draft!.baseHash),
    onSaved: () => {
      toast(`Đã lưu quyền vào ${draft?.path}. Bản cũ nằm trong Lịch sử thay đổi.`);
      clearDraft(permissionsKey(scope));
      onSaved();
    },
  });
}

/** Edits allow/ask/deny rules and the default mode of one settings file. */
export function PermissionsEditor({ scope, draft }: { scope: Scope; draft: PermissionsDraft }) {
  const modeId = useId();
  const update = (p: Partial<Permissions>) => setDraft(permissionsKey(scope), { ...draft, permissions: { ...draft.permissions, ...p } });

  return (
    <div className="perm-editor">
      <div className="perm-mode">
        <label htmlFor={modeId}>Chế độ mặc định</label>
        <select id={modeId} value={draft.permissions.defaultMode ?? ""} onChange={(e) => update({ defaultMode: e.target.value || null })}>
          {MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="rule-columns">
        {COLUMNS.map((c) => (
          <RuleColumn
            key={c.key}
            title={c.title}
            tone={c.key}
            example={c.example}
            rules={draft.permissions[c.key]}
            onChange={(rules) => update({ [c.key]: rules })}
          />
        ))}
      </div>
    </div>
  );
}

function RuleColumn(props: {
  title: string;
  tone: "allow" | "ask" | "deny";
  example: string;
  rules: string[];
  onChange: (rules: string[]) => void;
}) {
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
            <button type="button" className="rule-remove" aria-label={`Bỏ luật ${r}`} onClick={() => props.onChange(props.rules.filter((x) => x !== r))}>
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
          Thêm luật {props.title.toLowerCase()}
        </label>
        <input id={inputId} value={value} onChange={(e) => setValue(e.target.value)} placeholder={props.example} spellCheck={false} />
        <button type="submit" className="rule-add-btn" aria-label={`Thêm vào ${props.title}`} disabled={!value.trim()}>
          <Plus weight="bold" />
        </button>
      </form>
    </div>
  );
}
