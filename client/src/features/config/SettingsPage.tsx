import { PencilSimple, Prohibit, Question, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { SettingsFile } from "../../api/types";
import { Button } from "../../components/Button";
import { toast } from "../../components/Toast";
import { getDraft, setDraft, useDrafts } from "./drafts";
import { ConfigHeader, LoadError, RuleChip, ScopeTag, SCOPE_HINT } from "./parts";
import { PermissionsEditor, permissionsKey, type PermissionsDraft } from "./PermissionsEditor";
import { useConfig } from "./useConfig";

const MODE_LABEL: Record<string, string> = {
  default: "Hỏi trước mỗi thao tác cần quyền",
  acceptEdits: "Tự sửa file, hỏi trước lệnh shell",
  plan: "Chỉ lập kế hoạch, không sửa",
  auto: "Tự quyết theo mức rủi ro",
  bypassPermissions: "Bỏ qua mọi kiểm tra quyền",
};

/** Permission rules and env of each settings scope. Deny beats ask beats allow in Claude Code. */
export function SettingsPage() {
  const { data, error, loading, reload } = useConfig(["settings"], api.settings);
  const files = data ?? [];
  const totals = files.reduce((t, f) => ({ allow: t.allow + f.allow.length, ask: t.ask + f.ask.length, deny: t.deny + f.deny.length }), { allow: 0, ask: 0, deny: 0 });

  return (
    <div className="page">
      <ConfigHeader
        title="Settings & quyền"
        subtitle="Claude gộp các file dưới đây; luật chặn luôn thắng luật cho phép"
        loading={loading}
        onReload={() => void reload()}
        actions={<span className="scope-hint">Bấm "Sửa quyền" ở từng file</span>}
      />
      <LoadError error={error} />
      <div className="page-body settings">
        {data && (
          <div className="totals" aria-label="Tổng hợp">
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
          </div>
        )}
        {files.map((f) => (
          <ScopeSection key={f.scope} file={f} onSaved={() => void reload()} />
        ))}
      </div>
    </div>
  );
}

function ScopeSection({ file, onSaved }: { file: SettingsFile; onSaved: () => void }) {
  useDrafts();
  const draft = getDraft<PermissionsDraft>(permissionsKey(file.scope));
  const [opening, setOpening] = useState(false);

  const startEditing = async () => {
    setOpening(true);
    try {
      const p = await api.permissions(file.scope);
      setDraft(permissionsKey(file.scope), {
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

  return (
    <section className="card scope-section" aria-labelledby={`settings-${file.scope}`}>
      <header className="scope-head">
        <ScopeTag scope={file.scope} />
        <h2 id={`settings-${file.scope}`} className="mono">
          {file.path}
        </h2>
        <span className="scope-hint">{SCOPE_HINT[file.scope]}</span>
        {!draft && !file.error && (
          <Button icon={PencilSimple} variant="quiet" className="scope-edit" busy={opening} onClick={() => void startEditing()}>
            {file.exists ? "Sửa quyền" : "Thêm quyền"}
          </Button>
        )}
      </header>
      {draft ? (
        <PermissionsEditor scope={file.scope} draft={draft} onSaved={onSaved} />
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
