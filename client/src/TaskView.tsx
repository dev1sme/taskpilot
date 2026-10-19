import { useCallback, useEffect, useState } from "react";
import { api, onServerEvent, type SessionView, type TaskSummary } from "./api";
import { DocsView } from "./DocsView";
import { Terminal } from "./Terminal";
import { WorkflowPanel } from "./WorkflowPanel";

const DOCS = "docs";

export function TaskView({ task }: { task: TaskSummary }) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [tab, setTab] = useState<string>(DOCS);
  const [docFocus, setDocFocus] = useState<{ path: string; nonce: number }>();
  const [error, setError] = useState<string | null>(null);

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

  const active = sessions.find((s) => s.id === tab) ?? null;

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
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === DOCS} onClick={() => setTab(DOCS)}>
          Tài liệu
        </button>
        {sessions.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} onClick={() => setTab(s.id)}>
            <span className={`dot ${s.status}`} aria-label={s.status === "running" ? "đang chạy" : "đã dừng"} />
            {s.title}
            {s.activity === "permission" && <span className="tab-flag">chờ quyền</span>}
          </button>
        ))}
        <button
          type="button"
          className="new-session"
          onClick={() =>
            void run(async () => {
              const s = await api.createSession(task.key);
              setTab(s.id);
            })
          }
        >
          + Session mới
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tab-body" hidden={tab !== DOCS}>
        <DocsView task={task} focus={docFocus} />
      </div>
      {active && <SessionPanel key={active.id} session={active} run={run} onRemoved={() => setTab(DOCS)} />}
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
  // Bumped on resume so the terminal reconnects and replays from the server.
  const [generation, setGeneration] = useState(0);
  const running = session.status === "running";

  return (
    <div className="session-panel">
      <div className="session-bar">
        <code title="Claude session id">{session.id}</code>
        <span className="status">
          {running ? "Đang chạy" : `Đã dừng${session.exitCode !== null ? ` (mã ${session.exitCode})` : ""}`}
        </span>
        {running ? (
          <button type="button" onClick={() => void run(() => api.stopSession(session.id))}>
            Dừng
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await api.resumeSession(session.id);
                  setGeneration((g) => g + 1);
                })
              }
            >
              Resume
            </button>
            {confirmRemove ? (
              <button
                type="button"
                className="danger"
                onClick={() =>
                  void run(async () => {
                    await api.forgetSession(session.id);
                    props.onRemoved();
                  })
                }
              >
                Xác nhận xoá khỏi task
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)}>
                Xoá
              </button>
            )}
          </>
        )}
      </div>
      <Terminal key={generation} sessionId={session.id} onExit={() => void run(async () => {})} />
    </div>
  );
}
