import { PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { HookEntry, Scope } from "../../api/types";
import { toast } from "../../components/Toast";
import { getDraft, setDraft, useDrafts } from "./drafts";
import { HOOKS_DRAFT, HooksEditor, type HooksDraft } from "./HooksEditor";
import { ConfigHeader, EmptyCard, LoadError, ScopeTag, SCOPE_LABEL } from "./parts";
import { useConfig } from "./useConfig";

const EVENT_HINT: Record<string, string> = {
  PreToolUse: "Trước khi Claude dùng một công cụ; có thể chặn thao tác",
  PostToolUse: "Sau khi một công cụ chạy xong",
  PostToolUseFailure: "Sau khi một công cụ chạy lỗi",
  PermissionRequest: "Khi Claude xin quyền",
  UserPromptSubmit: "Khi ba gửi một prompt",
  Notification: "Khi Claude gửi thông báo (chờ quyền, đang rảnh…)",
  Stop: "Khi Claude kết thúc một lượt",
  SubagentStop: "Khi một subagent kết thúc",
  SessionStart: "Khi session bắt đầu hoặc được resume",
  SessionEnd: "Khi session kết thúc",
  PreCompact: "Trước khi Claude nén ngữ cảnh",
};

/** Hook commands from all settings files, grouped by the event that triggers them. */
export function HooksPage() {
  const { data, error, loading, reload } = useConfig(api.hooks);
  useDrafts();
  const draft = getDraft<HooksDraft>(HOOKS_DRAFT);
  const [opening, setOpening] = useState<Scope | null>(null);
  const groups = new Map<string, HookEntry[]>();

  const edit = async (scope: Scope) => {
    setOpening(scope);
    try {
      const f = await api.hooksFile(scope);
      setDraft(HOOKS_DRAFT, { scope, hooks: f.hooks, baseHash: f.hash, path: f.path } satisfies HooksDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setOpening(null);
    }
  };
  for (const h of data ?? []) groups.set(h.event, [...(groups.get(h.event) ?? []), h]);

  return (
    <div className="page">
      <ConfigHeader
        title="Hooks"
        subtitle="Lệnh tự chạy theo sự kiện của Claude, lấy từ các file settings"
        loading={loading}
        onReload={() => void reload()}
        actions={
          !draft && (
            <>
            <span className="scope-hint" aria-hidden="true">Sửa hooks của:</span>
            <div className="segmented" role="group" aria-label="Sửa hooks của">
              {(["project", "local", "user"] as Scope[]).map((s) => (
                <button key={s} type="button" onClick={() => void edit(s)} disabled={opening !== null}>
                  <PencilSimple aria-hidden="true" /> {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
            </>
          )
        }
      />
      <LoadError error={error} />
      <div className="page-body hooks">
        {draft && <HooksEditor draft={draft} onSaved={() => void reload()} />}
        {!draft && data && data.length === 0 && (
          <EmptyCard title="Chưa có hook nào">
            Hook khai báo trong .claude/settings.json (mục "hooks"). TaskPilot tự gắn hook riêng cho session nó mở; các hook đó
            không nằm trong file nên không hiện ở đây.
          </EmptyCard>
        )}
        {!draft && [...groups.entries()].map(([event, hooks]) => (
          <section key={event} className="card hook-group" aria-labelledby={`hook-${event}`}>
            <header className="hook-head">
              <h2 id={`hook-${event}`} className="mono">
                {event}
              </h2>
              <span className="scope-hint">{EVENT_HINT[event] ?? ""}</span>
            </header>
            <ul className="hook-list">
              {hooks.map((h, i) => (
                <li key={i}>
                  <span className="matcher" title="Matcher">
                    {h.matcher}
                  </span>
                  <code className="hook-command">{h.command}</code>
                  <span className="hook-meta">
                    {h.timeout ? `${h.timeout}s · ` : ""}
                    <ScopeTag scope={h.scope} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
