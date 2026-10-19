import { useCallback, useEffect, useState } from "react";
import { api, onServerEvent, token, type RepoInfo, type Stage, type TaskSummary } from "./api";
import { TaskView } from "./TaskView";

const STAGE_LABEL: Record<Stage, string> = {
  new: "Mới",
  investigated: "Đã điều tra",
  planned: "Có plan",
  implementing: "Đang code",
  summarized: "Có tóm tắt",
};

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api.tasks());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api
      .repo()
      .then((r) => {
        setRepo(r);
        if (r.path) void loadTasks();
      })
      .catch((e: Error) => setError(e.message));
  }, [loadTasks]);

  useEffect(() => {
    const offTasks = onServerEvent("tasks", () => void loadTasks());
    const offRepo = onServerEvent("repo", () => void loadTasks());
    return () => {
      offTasks();
      offRepo();
    };
  }, [loadTasks]);

  if (!token) {
    return (
      <main className="empty-state">
        <h1>TaskPilot</h1>
        <p>Thiếu token. Mở đúng URL mà server in ra khi khởi động (có <code>?token=…</code>).</p>
      </main>
    );
  }

  const current = tasks.find((t) => t.key === selected) ?? null;

  return (
    <div className="layout">
      <header>
        <h1>TaskPilot</h1>
        <RepoPicker
          repo={repo}
          onChange={async (path) => {
            const r = await api.setRepo(path);
            setRepo(r);
            setSelected(null);
            await loadTasks();
          }}
        />
      </header>
      {error && <p className="error">{error}</p>}
      <aside>
        {repo?.path && !repo.tasksDirExists && (
          <p className="hint">
            Repo chưa có <code>.claude/tasks/</code>.
          </p>
        )}
        {repo?.path && repo.tasksDirExists && tasks.length === 0 && (
          <p className="hint">
            Chưa có task nào. Mỗi task cần <code>.claude/tasks/&lt;key&gt;/spec/*.md</code>.
          </p>
        )}
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.key}>
              <button type="button" aria-pressed={t.key === selected} onClick={() => setSelected(t.key)}>
                <span className="key">{t.key}</span>
                <span className={`stage stage-${t.stage}`}>{STAGE_LABEL[t.stage]}</span>
                {t.title !== t.key && <span className="title">{t.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="detail">
        {current ? <TaskView key={current.key} task={current} /> : <p className="hint">Chọn một task để xem.</p>}
      </section>
    </div>
  );
}

function RepoPicker({ repo, onChange }: { repo: RepoInfo | null; onChange: (path: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(repo?.path ?? ""), [repo?.path]);

  return (
    <form
      className="repo-picker"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onChange(value);
          setError(null);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="/đường/dẫn/tới/repo"
        aria-label="Đường dẫn repo"
        spellCheck={false}
      />
      <button type="submit" disabled={busy || !value.trim()}>
        Mở repo
      </button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}
