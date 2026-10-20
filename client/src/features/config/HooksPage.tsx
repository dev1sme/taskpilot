import { Eye, PencilSimple, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { HooksFile, Scope } from "../../api/types";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { toast } from "../../components/Toast";
import { getDraft, isDirty, setDraft, useDrafts } from "./drafts";
import { EMPTY_HOOK, HooksEditor, hooksKey, useHooksSave, type HooksDraft } from "./HooksEditor";
import { ConfigHeader, ConfigToolbar, DraftControls, EmptyCard, LoadError, ScopeTabs } from "./parts";
import { useConfig } from "./useConfig";

const TAB_LABEL: Record<Scope, string> = { project: ".claude/settings.json", local: ".claude/settings.local.json", user: "~/.claude/settings.json" };

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

/** An event key in the pretty-printed hooks block: `  "PostToolUse": [`. */
const EVENT_LINE = /^ {2}"([^"]+)": \[/;

/** Hooks of one settings file at a time, shown as the JSON block written in the file; edited as rows. */
export function HooksPage() {
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
        Xem thay đổi &amp; lưu
      </Button>
    </>
  ) : (
    data && (
      <Button
        icon={hasHooks ? PencilSimple : Plus}
        variant="primary"
        busy={opening}
        title={`${hasHooks ? "Sửa hooks" : "Thêm hook"} trong ${data.path}`}
        onClick={() => void startEditing()}
      >
        {hasHooks ? "Sửa" : "Thêm"}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title="Hooks" subtitle={'Lệnh tự chạy theo sự kiện của Claude, khai báo trong mục "hooks" của các file settings'} />
      <ConfigToolbar
        start={<ScopeTabs value={scope} onChange={setScope} label="File settings" labels={TAB_LABEL} isDirty={(s) => isDirty(hooksKey(s))} />}
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
            <EmptyCard title={`${TAB_LABEL[scope]} chưa có hook nào`}>
              {data.exists ? "File này chưa có mục \"hooks\"." : "Chưa có file này."} TaskPilot tự gắn hook riêng cho session nó
              mở; các hook đó không nằm trong file nên không hiện ở đây.
            </EmptyCard>
          </div>
        ))
      )}
      <DiffDialog {...flow.dialog} confirmLabel="Lưu hooks" />
    </div>
  );
}

function HooksView({ file }: { file: HooksFile }) {
  const lines = JSON.stringify(file.raw, null, 2).split("\n");
  const events = lines.flatMap((text, i) => {
    const m = EVENT_LINE.exec(text);
    return m ? [{ name: m[1], line: i + 1 }] : [];
  });

  const jump = (line: number) => document.getElementById(`hook-L${line}`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="memory hooks-view">
      <nav className="memory-outline" aria-label="Sự kiện">
        <div className="pane-label">Sự kiện</div>
        {events.map((e) => (
          <button key={e.line} type="button" className="outline-item hook-event" title={EVENT_HINT[e.name]} onClick={() => jump(e.line)}>
            <span className="mono">{e.name}</span>
            {EVENT_HINT[e.name] && <span className="hook-event-hint">{EVENT_HINT[e.name]}</span>}
          </button>
        ))}
      </nav>

      <section className="code-view" aria-label={`Hooks trong ${file.path}`}>
        <div className="code-head">
          <span className="mono">
            {file.path} › hooks
          </span>
          <span className="code-meta">{lines.length} dòng</span>
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
