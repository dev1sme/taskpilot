import { Eye, PencilSimple, Plus, Prohibit, Question, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { Scope, SettingsFile } from "../../api/types";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { toast } from "../../components/Toast";
import { getDraft, isDirty, setDraft, useDrafts } from "./drafts";
import { ConfigHeader, ConfigToolbar, DraftControls, LoadError, RuleChip, ScopeTabs, ScopeTag, SCOPE_HINT } from "./parts";
import { PermissionsEditor, permissionsKey, usePermissionsSave, type PermissionsDraft } from "./PermissionsEditor";
import { useConfig } from "./useConfig";

const MODE_LABEL: Record<string, string> = {
  default: "Hỏi trước mỗi thao tác cần quyền",
  acceptEdits: "Tự sửa file, hỏi trước lệnh shell",
  plan: "Chỉ lập kế hoạch, không sửa",
  auto: "Tự quyết theo mức rủi ro",
  bypassPermissions: "Bỏ qua mọi kiểm tra quyền",
};

const TAB_LABEL: Record<Scope, string> = { project: ".claude/settings.json", local: ".claude/settings.local.json", user: "~/.claude/settings.json" };

/** Permission rules and env of each settings scope, one file at a time. Deny beats ask beats allow in Claude Code. */
export function SettingsPage() {
  const { data, error, loading, reload } = useConfig(["settings"], api.settings);
  const [scope, setScope] = useState<Scope>("project");
  const [opening, setOpening] = useState(false);
  useDrafts();
  const draft = getDraft<PermissionsDraft>(permissionsKey(scope));
  const files = data ?? [];
  const file = files.find((f) => f.scope === scope);
  const totals = files.reduce((t, f) => ({ allow: t.allow + f.allow.length, ask: t.ask + f.ask.length, deny: t.deny + f.deny.length }), { allow: 0, ask: 0, deny: 0 });

  const startEditing = async () => {
    setOpening(true);
    try {
      const p = await api.permissions(scope);
      setDraft(permissionsKey(scope), {
        permissions: { allow: p.allow, ask: p.ask, deny: p.deny, defaultMode: p.defaultMode },
        baseHash: p.hash,
        path: p.path,
      } satisfies PermissionsDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = usePermissionsSave(scope, draft, () => void reload());

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={permissionsKey(scope)} />
      <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
        Xem thay đổi &amp; lưu
      </Button>
    </>
  ) : (
    file &&
    !file.error && (
      <Button icon={file.exists ? PencilSimple : Plus} variant="primary" busy={opening} onClick={() => void startEditing()}>
        {file.exists ? "Sửa quyền" : "Thêm quyền"}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title="Settings & quyền" subtitle="Claude gộp cả 3 file settings; luật chặn luôn thắng luật cho phép" />
      <ConfigToolbar
        start={
          <ScopeTabs
            value={scope}
            onChange={setScope}
            label="File settings"
            labels={TAB_LABEL}
            isMissing={(s) => files.find((f) => f.scope === s)?.exists === false && !getDraft(permissionsKey(s))}
            isDirty={(s) => isDirty(permissionsKey(s))}
          />
        }
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      <div className="page-body settings">
        {data && (
          <div className="totals" aria-label="Tổng hợp cả 3 file">
            <div className="total allow">
              <ShieldCheck weight="fill" aria-hidden="true" />
              <strong>{totals.allow}</strong> cho phép
            </div>
            <div className="total ask">
              <Question weight="fill" aria-hidden="true" />
              <strong>{totals.ask}</strong> hỏi trước
            </div>
            <div className="total deny">
              <Prohibit weight="fill" aria-hidden="true" />
              <strong>{totals.deny}</strong> bị chặn
            </div>
            <span className="scope-hint totals-note">Tổng cả 3 file, Claude áp dụng gộp</span>
          </div>
        )}
        {file && <ScopeSection file={file} draft={draft} />}
      </div>
      <DiffDialog {...flow.dialog} confirmLabel="Lưu quyền" />
    </div>
  );
}

function ScopeSection({ file, draft }: { file: SettingsFile; draft: PermissionsDraft | undefined }) {
  return (
    <section className="card scope-section" aria-labelledby={`settings-${file.scope}`}>
      <header className="scope-head">
        <ScopeTag scope={file.scope} />
        <h2 id={`settings-${file.scope}`} className="mono">
          {file.path}
        </h2>
        <span className="scope-hint">{SCOPE_HINT[file.scope]}</span>
      </header>
      {draft ? (
        <PermissionsEditor scope={file.scope} draft={draft} />
      ) : !file.exists ? (
        <p className="hint">Chưa có file này.</p>
      ) : file.error ? (
        <p className="error" role="alert">
          {file.error}
        </p>
      ) : (
        <>
          {file.defaultMode && (
            <p className="mode-line">
              Chế độ mặc định: <code>{file.defaultMode}</code> · {MODE_LABEL[file.defaultMode] ?? ""}
            </p>
          )}
          <div className="rule-columns">
            <RuleList title="Cho phép" tone="allow" rules={file.allow} />
            <RuleList title="Hỏi trước" tone="ask" rules={file.ask} />
            <RuleList title="Chặn" tone="deny" rules={file.deny} />
          </div>
          {file.additionalDirectories.length > 0 && (
            <p className="mode-line">
              Thư mục thêm: {file.additionalDirectories.map((d) => <code key={d}>{d}</code>)}
            </p>
          )}
          {file.env.length > 0 && (
            <div className="env-table">
              <div className="pane-label">Biến môi trường</div>
              {file.env.map((e) => (
                <div key={e.key} className="env-row">
                  <span className="mono">{e.key}</span>
                  <span className={`mono env-value${e.reference ? " is-ref" : ""}`}>{e.value}</span>
                </div>
              ))}
            </div>
          )}
          {file.otherKeys.length > 0 && <p className="hint">Khác: {file.otherKeys.join(", ")}</p>}
        </>
      )}
    </section>
  );
}

function RuleList({ title, tone, rules }: { title: string; tone: "allow" | "ask" | "deny"; rules: string[] }) {
  return (
    <div className={`rule-list tone-${tone}`}>
      <div className="rule-list-head">
        {title} <span>{rules.length}</span>
      </div>
      {rules.length === 0 ? (
        <p className="hint">Không có</p>
      ) : (
        <ul>
          {rules.map((r) => (
            <li key={r}>
              <RuleChip rule={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
