import { ArrowClockwise, FileText, HandPalm, Plus, Stop, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, onServerEvent, type SessionView, type TaskSummary } from "./api";
import { DocsView } from "./DocsView";
import { Terminal } from "./Terminal";
import { Button, SrOnly } from "./ui";
import { WorkflowPanel } from "./WorkflowPanel";

const DOCS = "docs";

export function TaskView({ task }: { task: TaskSummary }) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [tab, setTab] = useState<string>(DOCS);
  const [docFocus, setDocFocus] = useState<{ path: string; nonce: number }>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabsId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const load = useCallback(async () => {
    try {
      setSessions(await api.sessions(task.key));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [task.key]);

  useEffect(() => {
    void load();
    return onServerEvent("sessions", (data) => {
      if ((data as { taskKey?: string }).taskKey === task.key) void load();
    });
  }, [load, task.key]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
  };

  const tabIds = [DOCS, ...sessions.map((s) => s.id)];
  const active = sessions.find((s) => s.id === tab) ?? null;
  const tabDomId = (id: string) => `${tabsId}-tab-${id}`;
  const panelDomId = (id: string) => `${tabsId}-panel-${id}`;

  // ARIA tabs: arrows move between tabs, Home/End jump to the ends.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabIds.indexOf(tab);
    const next =
      e.key === "ArrowRight" ? tabIds[(i + 1) % tabIds.length]
      : e.key === "ArrowLeft" ? tabIds[(i - 1 + tabIds.length) % tabIds.length]
      : e.key === "Home" ? tabIds[0]
      : e.key === "End" ? tabIds[tabIds.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  const tabProps = (id: string) => ({
    id: tabDomId(id),
    role: "tab" as const,
    type: "button" as const,
    "aria-selected": tab === id,
    "aria-controls": panelDomId(id),
    tabIndex: tab === id ? 0 : -1,
    onClick: () => setTab(id),
    ref: (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(id, el);
      else tabRefs.current.delete(id);
    },
  });

  return (
    <div className="task-view">
      <h2 className="task-heading">
        <span className="task-key">{task.key}</span>
        {task.title !== task.key && <span className="task-title">{task.title}</span>}
      </h2>
      <WorkflowPanel
        taskKey={task.key}
        onShowSession={(id) => {
          void load();
          setTab(id);
        }}
        onShowFile={(path) => {
          setDocFocus((f) => ({ path, nonce: (f?.nonce ?? 0) + 1 }));
          setTab(DOCS);
        }}
      />
      <div className="tab-bar">
        <div className="tabs" role="tablist" aria-label="Tài liệu và session" onKeyDown={onTabKey}>
          <button {...tabProps(DOCS)}>
            <FileText className="tab-icon" aria-hidden="true" />
            Tài liệu
          </button>
          {sessions.map((s) => (
            <button key={s.id} {...tabProps(s.id)}>
              <span className={`session-dot ${s.status}`} aria-hidden="true" />
              {s.title}
              <SrOnly>{s.status === "running" ? ", đang chạy" : ", đã dừng"}</SrOnly>
              {s.activity === "permission" && (
                <span className="tab-flag">
                  <HandPalm aria-hidden="true" />
                  chờ quyền
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          icon={Plus}
          variant="quiet"
          className="new-session"
          busy={creating}
          onClick={() => {
            setCreating(true);
            void run(async () => {
              const s = await api.createSession(task.key);
              setTab(s.id);
            }).finally(() => setCreating(false));
          }}
        >
          Session mới
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="tab-body" role="tabpanel" id={panelDomId(DOCS)} aria-labelledby={tabDomId(DOCS)} hidden={tab !== DOCS}>
        <DocsView task={task} focus={docFocus} />
      </div>
      {active && (
        <div className="session-panel" role="tabpanel" id={panelDomId(active.id)} aria-labelledby={tabDomId(active.id)}>
          <SessionPanel key={active.id} session={active} run={run} onRemoved={() => setTab(DOCS)} />
        </div>
      )}
    </div>
  );
}

function SessionPanel(props: {
  session: SessionView;
  run: (action: () => Promise<unknown>) => Promise<void>;
  onRemoved: () => void;
}) {
  const { session, run } = props;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<"stop" | "resume" | "remove" | null>(null);
  // Bumped on resume so the terminal reconnects and replays from the server.
  const [generation, setGeneration] = useState(0);
  const running = session.status === "running";

  const act = (name: NonNullable<typeof busy>, action: () => Promise<unknown>) => {
    setBusy(name);
    void run(action).finally(() => setBusy(null));
  };

  return (
    <>
      <div className="session-bar">
        <span className={`session-state ${session.status}`}>
          <span className={`session-dot ${session.status}`} aria-hidden="true" />
          {running ? "Đang chạy" : `Đã dừng${session.exitCode !== null ? ` (mã ${session.exitCode})` : ""}`}
        </span>
        <code className="session-id" title="Claude session id">
          {session.id}
        </code>
        <div className="session-actions">
          {running ? (
            <Button icon={Stop} busy={busy === "stop"} onClick={() => act("stop", () => api.stopSession(session.id))}>
              Dừng
            </Button>
          ) : (
            <>
              <Button
                icon={ArrowClockwise}
                variant="primary"
                busy={busy === "resume"}
                onClick={() =>
                  act("resume", async () => {
                    await api.resumeSession(session.id);
                    setGeneration((g) => g + 1);
                  })
                }
              >
                Resume
              </Button>
              {confirmRemove ? (
                <>
                  <Button
                    icon={Trash}
                    variant="danger"
                    busy={busy === "remove"}
                    onClick={() =>
                      act("remove", async () => {
                        await api.forgetSession(session.id);
                        props.onRemoved();
                      })
                    }
                  >
                    Xoá khỏi task
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmRemove(false)}>
                    Giữ lại
                  </Button>
                </>
              ) : (
                <Button icon={Trash} variant="quiet" onClick={() => setConfirmRemove(true)}>
                  Xoá
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {confirmRemove && !running && (
        <p className="field-help">Chỉ gỡ session khỏi task. Lịch sử hội thoại của Claude vẫn còn.</p>
      )}
      <Terminal key={generation} sessionId={session.id} onExit={() => void run(async () => {})} />
    </>
  );
}
