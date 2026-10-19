import { CheckCircle, CircleNotch, FolderOpen, HandPalm } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useState } from "react";
import { api, onServerEvent, token, type RepoInfo, type Stage, type TaskSummary } from "./api";
import { TaskView } from "./TaskView";
import { Button } from "./ui";

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
    // Run phase and permission prompts are shown in the list too.
    const offs = ["tasks", "repo", "run", "sessions"].map((e) => onServerEvent(e, () => void loadTasks()));
    return () => offs.forEach((off) => off());
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
  // Tasks that need the user come first, then the most recently touched.
  const ordered = [...tasks].sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt);

  return (
    <div className="layout">
      <header>
        <h1 className="brand">TaskPilot</h1>
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
      <aside aria-label="Danh sách task">
        {!repo?.path && <p className="hint">Nhập đường dẫn repo ở trên để xem task.</p>}
        {repo?.path && !repo.tasksDirExists && (
          <p className="hint">
            Repo này chưa có <code>.claude/tasks/</code>. Tạo <code>.claude/tasks/&lt;key&gt;/spec/</code> và
            viết yêu cầu vào đó.
          </p>
        )}
        {repo?.path && repo.tasksDirExists && tasks.length === 0 && (
          <p className="hint">
            Chưa có task nào. Mỗi task là một thư mục <code>.claude/tasks/&lt;key&gt;/spec/</code> chứa file
            <code>.md</code>.
          </p>
        )}
        <ul className="strips" aria-label="Task">
          {ordered.map((t) => {
            const status = statusOf(t);
            return (
              <li key={t.key}>
                <button
                  type="button"
                  className={`strip ${status.tone}`}
                  aria-pressed={t.key === selected}
                  onClick={() => setSelected(t.key)}
                >
                  <span className="strip-key">{t.key}</span>
                  <span className="strip-status">
                    <StatusIcon tone={status.tone} />
                    {status.label}
                  </span>
                  {t.title !== t.key && <span className="strip-title">{t.title}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <main className="detail">
        {current ? (
          <TaskView key={current.key} task={current} />
        ) : (
          tasks.length > 0 && <p className="hint">Chọn một task bên trái để xem spec và chạy quy trình.</p>
        )}
      </main>
    </div>
  );
}

function RepoPicker({ repo, onChange }: { repo: RepoInfo | null; onChange: (path: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

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
      <label htmlFor={inputId}>Repo</label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="/home/ban/projects/my-app"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />
      <Button type="submit" icon={FolderOpen} busy={busy} disabled={!value.trim()}>
        Mở repo
      </Button>
      {error && (
        <span className="error" id={`${inputId}-error`} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

type Tone = "attention" | "active" | "done" | "idle";

/** What the strip shows: what needs the user first, else the run, else the stage derived from files. */
function statusOf(task: TaskSummary): { tone: Tone; label: string } {
  if (task.waitingPermission) return { tone: "attention", label: "Chờ quyền" };
  const phase = task.run?.phase;
  if (phase === "gate") return { tone: "attention", label: "Chờ duyệt" };
  if (phase === "waiting") return { tone: "attention", label: "Chờ trả lời" };
  if (phase === "interrupted") return { tone: "attention", label: "Bị gián đoạn" };
  if (phase === "starting" || phase === "running") return { tone: "active", label: "Đang chạy" };
  if (phase === "done") return { tone: "done", label: "Hoàn tất" };
  return { tone: task.stage === "summarized" ? "done" : "idle", label: STAGE_LABEL[task.stage] };
}

function urgency(task: TaskSummary): number {
  return { attention: 2, active: 1, done: 0, idle: 0 }[statusOf(task).tone];
}

/** Shape cue next to the status text, so the strip does not rely on the band color alone. */
function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === "attention") return <HandPalm className="status-icon" aria-hidden="true" />;
  if (tone === "active") return <CircleNotch className="status-icon spin-slow" aria-hidden="true" />;
  if (tone === "done") return <CheckCircle className="status-icon" aria-hidden="true" />;
  return null;
}
