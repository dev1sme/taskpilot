import { useCallback, useEffect, useState } from "react";
import { api, token, type RepoInfo, type Stage, type TaskSummary } from "./api";
import { Markdown } from "./Markdown";

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
    const es = api.events();
    es.addEventListener("tasks", () => void loadTasks());
    es.addEventListener("repo", () => void loadTasks());
    return () => es.close();
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

function TaskView({ task }: { task: TaskSummary }) {
  const files = [...task.specFiles, ...task.outputFiles];
  const [picked, setOpen] = useState(files[0]?.path ?? "");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The picked file may disappear on disk; fall back to the first one.
  const open = files.some((f) => f.path === picked) ? picked : (files[0]?.path ?? "");

  // Reload when the selected file changes on disk (task.updatedAt moves on every watcher event).
  useEffect(() => {
    if (!open) return;
    api
      .file(task.key, open)
      .then((r) => {
        setContent(r.content);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [task.key, open, task.updatedAt]);

  return (
    <>
      <h2>{task.title === task.key ? task.key : `${task.key}: ${task.title}`}</h2>
      <nav className="files">
        <FileGroup label="Spec" files={task.specFiles.map((f) => f.path)} open={open} onOpen={setOpen} />
        <FileGroup label="Tài liệu" files={task.outputFiles.map((f) => f.path)} open={open} onOpen={setOpen} />
      </nav>
      {error ? <p className="error">{error}</p> : content !== null && <Markdown source={content} />}
    </>
  );
}

function FileGroup(props: { label: string; files: string[]; open: string; onOpen: (path: string) => void }) {
  if (props.files.length === 0) return null;
  return (
    <div className="file-group">
      <span className="label">{props.label}</span>
      {props.files.map((f) => (
        <button key={f} type="button" aria-pressed={f === props.open} onClick={() => props.onOpen(f)}>
          {f}
        </button>
      ))}
    </div>
  );
}
